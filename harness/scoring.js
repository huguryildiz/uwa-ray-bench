"use strict";

(function(root, factory){
  const api=factory();
  if(typeof module==="object"&&module.exports) module.exports=api;
  else root.UwaRayScoring=api;
})(typeof globalThis!=="undefined"?globalThis:this, function(){
  /* canonical comparison grid — fixed by the data contract, never varies
     (101 x, 49 y, 31 z; row-major x-fastest) */
  const NX=101, NY=49, NZ=31, NTL=NX*NY*NZ;
  const TL_SHADOW=120;
  const TL_ERR_CAP=25;          // dB — normalizes core/smoothed/receiver error terms
  const RECIP_CAP=3;            // dB — reciprocity qualification threshold
  const CONV_CAP=5;             // dB — convergence ΔTL(R) qualification threshold
  const WINSOR_CAP_DB=20;       // dB — |residual| clip before squaring (robust core error)
  const OOP_EPS_M=500;          // m  — floor on the geometry-error denominator
  const CELL_KM=0.5;            // km — x/y grid pitch, used to convert boundary-distance
                                 //      cell counts to an approximate physical distance
                                 //      (grid-quantized, not exact Euclidean — see docs)

  function finite(v){return v!=null&&Number.isFinite(+v);}
  function clamp01(v){return Math.max(0,Math.min(1,v));}
  function shadow(v){return !finite(v)||v>=TL_SHADOW;}
  function clampedTl(v){return Math.min(finite(v)?+v:TL_SHADOW, TL_SHADOW);}

  /* ---- A. validation gate ---------------------------------------------- */
  function validateModel(model){
    if(!model) return {status:'Invalid', reasons:['malformed metrics payload']};
    const tl=model.tl;
    const isArrayish=tl&&typeof tl.length==='number';
    if(!isArrayish) return {status:'Invalid', reasons:['malformed metrics payload']};
    if(tl.length<NTL) return {status:'Invalid', reasons:['incomplete canonical TL grid']};
    for(let i=0;i<NTL;i++){ if(!Number.isFinite(+tl[i])) return {status:'Invalid', reasons:['NaN in TL field']}; }

    const recipPresent=finite(model.reciprocity), convPresent=finite(model.conv_tlR);
    const invalid=[];
    if(recipPresent&&Math.abs(+model.reciprocity)>RECIP_CAP) invalid.push(`reciprocity error > ${RECIP_CAP} dB`);
    if(convPresent&&Math.abs(+model.conv_tlR)>CONV_CAP) invalid.push(`convergence ΔTL(R) > ${CONV_CAP} dB`);
    if(invalid.length) return {status:'Invalid', reasons:invalid};

    const provisional=[];
    if(!recipPresent) provisional.push('missing reciprocity result');
    if(!convPresent) provisional.push('missing convergence result');
    if(provisional.length) return {status:'Provisional', reasons:provisional};

    return {status:'Qualified', reasons:[]};
  }

  /* ---- helpers: robust field metrics ------------------------------------ */
  function boxBlur3D(field){
    const out=new Float32Array(field.length);
    const at=(ix,iy,iz)=>{
      ix=ix<0?0:ix>=NX?NX-1:ix; iy=iy<0?0:iy>=NY?NY-1:iy; iz=iz<0?0:iz>=NZ?NZ-1:iz;
      return field[ix+iy*NX+iz*NX*NY];
    };
    for(let iz=0;iz<NZ;iz++)for(let iy=0;iy<NY;iy++)for(let ix=0;ix<NX;ix++){
      let s=0;
      for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)
        s+=at(ix+dx,iy+dy,iz+dz);
      out[ix+iy*NX+iz*NX*NY]=s/27;
    }
    return out;
  }
  function smoothedError(ca,cb,rCls,ccnt){
    if(!ccnt) return null;
    const fa=boxBlur3D(ca), fb=boxBlur3D(cb);
    let sse=0;
    for(let i=0;i<rCls.length;i++){ if(!rCls[i]){ const d=fa[i]-fb[i]; sse+=d*d; } }
    return Math.sqrt(sse/ccnt);
  }

  /* multi-source 6-connected BFS grid-distance — O(N), used for an
     approximate average symmetric shadow-boundary distance (not exact
     Euclidean; see docs/benchmark_spec.md). */
  function boundarySet(cls){
    const set=[];
    for(let iz=0;iz<NZ;iz++)for(let iy=0;iy<NY;iy++)for(let ix=0;ix<NX;ix++){
      const i=ix+iy*NX+iz*NX*NY, c=cls[i];
      let boundary=false;
      if(ix>0&&cls[i-1]!==c)boundary=true;
      else if(ix<NX-1&&cls[i+1]!==c)boundary=true;
      else if(iy>0&&cls[i-NX]!==c)boundary=true;
      else if(iy<NY-1&&cls[i+NX]!==c)boundary=true;
      else if(iz>0&&cls[i-NX*NY]!==c)boundary=true;
      else if(iz<NZ-1&&cls[i+NX*NY]!==c)boundary=true;
      if(boundary)set.push(i);
    }
    return set;
  }
  function bfsDist(sources,n){
    const dist=new Int32Array(n).fill(-1);
    let frontier=sources.slice();
    for(const s of sources) dist[s]=0;
    let d=0;
    while(frontier.length){
      const next=[];
      for(const i of frontier){
        const iz=(i/(NX*NY))|0, rem=i-iz*NX*NY, iy=(rem/NX)|0, ix=rem-iy*NX;
        const nbrs=[];
        if(ix>0)nbrs.push(i-1); if(ix<NX-1)nbrs.push(i+1);
        if(iy>0)nbrs.push(i-NX); if(iy<NY-1)nbrs.push(i+NX);
        if(iz>0)nbrs.push(i-NX*NY); if(iz<NZ-1)nbrs.push(i+NX*NY);
        for(const nb of nbrs){ if(dist[nb]===-1){dist[nb]=d+1; next.push(nb);} }
      }
      frontier=next; d++;
    }
    return dist;
  }
  function boundaryDistanceKm(mCls,rCls,n){
    const mB=boundarySet(mCls), rB=boundarySet(rCls);
    if(!mB.length||!rB.length) return null;
    const distFromR=bfsDist(rB,n), distFromM=bfsDist(mB,n);
    let sa=0; for(const i of mB) sa+=distFromR[i]>=0?distFromR[i]:0;
    let sb=0; for(const i of rB) sb+=distFromM[i]>=0?distFromM[i]:0;
    return ((sa/mB.length)+(sb/rB.length))/2*CELL_KM;
  }

  function computeReceiverErrors(model,reference){
    const out=[];
    if(finite(model.tl_R)&&finite(reference.tl_R))
      out.push({id:'R', err:Math.abs(+model.tl_R-+reference.tl_R)});
    return out;
  }
  function medianClippedAbsError(errors,cap){
    if(!errors.length) return null;
    const vals=errors.map(e=>Math.min(e.err,cap)).sort((x,y)=>x-y);
    const mid=vals.length>>1;
    return vals.length%2?vals[mid]:(vals[mid-1]+vals[mid])/2;
  }

  function weightedError(terms){
    const avail=terms.filter(t=>t.e!=null&&isFinite(t.e));
    if(!avail.length) return null;
    const wsum=avail.reduce((s,t)=>s+t.w,0);
    return avail.reduce((s,t)=>s+t.w*t.e,0)/wsum;
  }
  function computeComposite(fieldFidelity,coverageFidelity,geometryFidelity){
    const terms=[{w:0.60,v:fieldFidelity},{w:0.20,v:coverageFidelity},{w:0.20,v:geometryFidelity}];
    const avail=terms.filter(t=>t.v!=null&&isFinite(t.v));
    if(!avail.length) return null;
    const wsum=avail.reduce((s,t)=>s+t.w,0);
    const value=avail.reduce((s,t)=>s+t.w*t.v,0)/wsum;
    return {value, provisional:avail.length<terms.length};
  }

  /* geometry error: |Δy_model - Δy_reference| normalized by the reference
     magnitude (floored) — an explicit error vs reference, not a raw
     deflection magnitude. */
  function oopError(model,reference){
    if(!model||!reference||!finite(model.out_of_plane)||!finite(reference.out_of_plane)) return null;
    return Math.abs(+model.out_of_plane-+reference.out_of_plane)/Math.max(Math.abs(+reference.out_of_plane),OOP_EPS_M);
  }

  /* ---- B. per-model score: field / coverage / geometry fidelity -------- */
  function scoreModel(model, reference, nLimit){
    if(!model||!reference) return null;
    const validation=validateModel(model);
    const a=model.tl, b=reference.tl;
    const hasArrays=a&&b&&typeof a.length==='number'&&typeof b.length==='number';
    const geometryErrKm=(finite(model.out_of_plane)&&finite(reference.out_of_plane))
      ?Math.abs(+model.out_of_plane-+reference.out_of_plane)/1000:null;
    const oopErr=oopError(model,reference);
    const geometryFidelity=oopErr!=null?100*(1-clamp01(oopErr)):null;

    if(!hasArrays){
      return {
        validation, rmse:null, coreRmse:null, coreRmseRaw:null, coreCells:0, maxErr:null,
        smoothedRmse:null, boundaryDistanceKm:null,
        receiverErrors:[], receiverErrorMedian:null, tlRerr:null,
        falseShadowRate:null, falseLightRate:null, maskError:null,
        fieldFidelity:null, coverageFidelity:null, geometryFidelity, geometryErrKm,
        composite:null, canonical:model.canonical!==false,
      };
    }

    const n=Math.min(a.length,b.length,nLimit||NTL);
    const full=a.length>=NTL&&b.length>=NTL;
    const ca=full?new Float32Array(NTL):null, cb=full?new Float32Array(NTL):null;
    const mCls=full?new Uint8Array(NTL):null, rCls=full?new Uint8Array(NTL):null;

    let se=0,cnt=0, cse=0,wse=0,ccnt=0,amax=0;
    let refLight=0, refShadow=0, falseShadow=0, falseLight=0;
    for(let i=0;i<n;i++){
      const av=clampedTl(a[i]), bv=clampedTl(b[i]);
      const d=av-bv;
      se+=d*d; cnt++;
      const mShadow=shadow(a[i]), rShadow=shadow(b[i]);
      if(full){ ca[i]=av; cb[i]=bv; mCls[i]=mShadow?1:0; rCls[i]=rShadow?1:0; }
      if(rShadow){
        refShadow++; if(!mShadow) falseLight++;
      }else{
        refLight++; if(mShadow) falseShadow++;
        cse+=d*d; ccnt++;
        const ad=Math.abs(d);
        if(ad>amax) amax=ad;
        const wd=Math.min(ad,WINSOR_CAP_DB);
        wse+=wd*wd;
      }
    }
    const rmse=cnt?Math.sqrt(se/cnt):null;
    const coreRmseRaw=ccnt?Math.sqrt(cse/ccnt):null;
    const coreRmse=ccnt?Math.sqrt(wse/ccnt):null;              // robust — primary Core TL Error
    const smoothedRmse=full?smoothedError(ca,cb,rCls,ccnt):null;
    const boundDist=full?boundaryDistanceKm(mCls,rCls,NTL):null;
    const falseShadowRate=refLight?falseShadow/refLight:0;
    const falseLightRate=refShadow?falseLight/refShadow:0;

    const receiverErrors=computeReceiverErrors(model,reference);
    const receiverErrorMedian=medianClippedAbsError(receiverErrors,TL_ERR_CAP);
    const tlRerr=receiverErrors.length?receiverErrors[0].err:null;

    const E_core=coreRmse!=null?clamp01(coreRmse/TL_ERR_CAP):null;
    const E_smooth=smoothedRmse!=null?clamp01(smoothedRmse/TL_ERR_CAP):null;
    const E_receiver=receiverErrorMedian!=null?clamp01(Math.min(receiverErrorMedian,TL_ERR_CAP)/TL_ERR_CAP):null;
    const E_field=weightedError([{w:0.50,e:E_core},{w:0.25,e:E_smooth},{w:0.25,e:E_receiver}]);
    const fieldFidelity=E_field!=null?100*(1-E_field):null;

    const E_coverage=0.5*(falseShadowRate+falseLightRate);
    const coverageFidelity=100*(1-clamp01(E_coverage));

    const composite=computeComposite(fieldFidelity,coverageFidelity,geometryFidelity);

    return {
      validation,
      rmse, coreRmse, coreRmseRaw, coreCells:ccnt, maxErr:amax,
      smoothedRmse, boundaryDistanceKm:boundDist,
      receiverErrors, receiverErrorMedian, tlRerr,
      falseShadowRate, falseLightRate, maskError:E_coverage,
      fieldFidelity, coverageFidelity, geometryFidelity, geometryErrKm,
      composite, canonical:model.canonical!==false,
    };
  }

  /* ---- C. official ranking: canonical models only. Validation status is
     shown for transparency but does NOT gate ranking eligibility — a project
     decision to keep every scored model comparable rather than empty out the
     ranking whenever self-reported reciprocity/convergence is absent or a cap
     is exceeded. NaN/incomplete TL cells already degrade gracefully to the
     120 dB shadow value inside scoreModel(), so this stays numerically safe. */
  function eligible(id,scores){
    const s=scores[id];
    return !!s&&s.canonical!==false;
  }
  function dimensionLeader(dim, modelIds, scores){
    let bestId=null, bestV=-Infinity;
    for(const id of modelIds){
      if(!eligible(id,scores)) continue;
      const v=scores[id][dim];
      if(v==null||!isFinite(v)) continue;
      if(bestId===null||v>bestV){ bestV=v; bestId=id; }
    }
    return bestId;
  }
  /* deterministic tie-break: lower robust core TL error, then lower balanced
     coverage error, then lower receiver error, then lexical panel id.
     Geometry is intentionally NOT part of the tie-break chain. */
  function compareForTiebreak(idA, idB, scores){
    const a=scores[idA], b=scores[idB];
    if(finite(a.coreRmse)&&finite(b.coreRmse)&&a.coreRmse!==b.coreRmse) return a.coreRmse<b.coreRmse?-1:1;
    if(finite(a.maskError)&&finite(b.maskError)&&a.maskError!==b.maskError) return a.maskError<b.maskError?-1:1;
    if(finite(a.receiverErrorMedian)&&finite(b.receiverErrorMedian)&&a.receiverErrorMedian!==b.receiverErrorMedian)
      return a.receiverErrorMedian<b.receiverErrorMedian?-1:1;
    return idA<idB?-1:idA>idB?1:0;
  }
  function compositeLeader(modelIds, scores){
    let bestId=null, bestV=-Infinity;
    for(const id of modelIds){
      if(!eligible(id,scores)) continue;
      const c=scores[id].composite;
      if(!c||c.value==null||!isFinite(c.value)) continue;
      if(bestId===null){ bestId=id; bestV=c.value; continue; }
      if(c.value>bestV){ bestId=id; bestV=c.value; }
      else if(c.value===bestV&&compareForTiebreak(id,bestId,scores)<0){ bestId=id; }
    }
    return bestId;
  }

  function sortScorecardRows(rows, key, dir){
    const sign=dir==='desc'?-1:1;
    return rows.map((row,i)=>({row,i})).sort((a,b)=>{
      const afixed=!!a.row.fixed, bfixed=!!b.row.fixed;
      if(afixed!==bfixed)return afixed?1:-1;
      if(afixed&&bfixed)return a.i-b.i;
      const av=a.row.values&&a.row.values[key];
      const bv=b.row.values&&b.row.values[key];
      const afin=finite(av), bfin=finite(bv);
      if(afin&&bfin){
        const d=(+av)-(+bv);
        if(d!==0)return d*sign;
      }
      if(afin!==bfin)return afin?-1:1;
      return a.i-b.i;
    }).map(x=>x.row);
  }

  return {
    NX, NY, NZ, NTL,
    TL_SHADOW, TL_ERR_CAP, RECIP_CAP, CONV_CAP, WINSOR_CAP_DB, OOP_EPS_M, CELL_KM,
    validateModel,
    scoreModel,
    oopError,
    eligible,
    dimensionLeader,
    compositeLeader,
    compareForTiebreak,
    sortScorecardRows,
  };
});
