"use strict";

(function(root, factory){
  const api=factory();
  if(typeof module==="object"&&module.exports) module.exports=api;
  else root.UwaRayScoring=api;
})(typeof globalThis!=="undefined"?globalThis:this, function(){
  const TL_SHADOW=120;
  const TL_ERR_CAP=25;
  const RECIP_CAP=3;
  const CONV_CAP=5;
  const LEADER_TIE_POINTS=2;
  const OOP_EPS_M=500;

  function finite(v){return v!=null&&Number.isFinite(+v);}
  function clamp01(v){return Math.max(0,Math.min(1,v));}
  function capped(v,cap){return clamp01(Math.abs(v)/cap);}
  function shadow(v){return !finite(v)||v>=TL_SHADOW;}
  function clampedTl(v){return Math.min(finite(v)?+v:TL_SHADOW, TL_SHADOW);}

  function scoreModel(model, reference, nLimit){
    if(!model||!reference||!model.tl||!reference.tl) return null;
    const a=model.tl, b=reference.tl;
    const n=Math.min(a.length,b.length,nLimit||a.length||b.length);
    let se=0,cnt=0,cse=0,ccnt=0,amax=0;
    let refLight=0, refShadow=0, falseShadow=0, falseLight=0;
    for(let i=0;i<n;i++){
      const av=clampedTl(a[i]);
      const bv=clampedTl(b[i]);
      const d=av-bv;
      se+=d*d; cnt++;

      const mShadow=shadow(a[i]);
      const rShadow=shadow(b[i]);
      if(rShadow){
        refShadow++;
        if(!mShadow) falseLight++;
      }else{
        refLight++;
        if(mShadow) falseShadow++;
        cse+=d*d; ccnt++;
        if(Math.abs(d)>amax) amax=Math.abs(d);
      }
    }
    const rmse=cnt?Math.sqrt(se/cnt):null;
    const coreRmse=ccnt?Math.sqrt(cse/ccnt):null;
    const falseShadowRate=refLight?falseShadow/refLight:0;
    const falseLightRate=refShadow?falseLight/refShadow:0;
    const maskError=0.5*(falseShadowRate+falseLightRate);
    const tlRerr=(finite(model.tl_R)&&finite(reference.tl_R))?Math.abs(+model.tl_R-+reference.tl_R):null;
    const recip=finite(model.reciprocity)?Math.abs(+model.reciprocity):null;
    const conv=finite(model.conv_tlR)?Math.abs(+model.conv_tlR):null;
    const eTl=coreRmse!=null?coreRmse/TL_ERR_CAP:null;
    const eR=tlRerr!=null?capped(tlRerr,TL_ERR_CAP):1;
    const eCons=0.5*(recip!=null?capped(recip,RECIP_CAP):1)+0.5*(conv!=null?capped(conv,CONV_CAP):1);
    const leaderScore=eTl!=null
      ? 100*(0.55*eTl+0.25*maskError+0.15*eR+0.05*eCons)
      : null;

    return {
      rmse, coreRmse, coreCells:ccnt, maxErr:amax, tlRerr,
      falseShadowRate, falseLightRate, maskError,
      leaderScore,
      canonical: model.canonical!==false,
    };
  }

  function oopError(model, reference){
    if(!model||!reference||!finite(model.out_of_plane)||!finite(reference.out_of_plane)) return null;
    return Math.abs(+model.out_of_plane-+reference.out_of_plane)/Math.max(Math.abs(+reference.out_of_plane),OOP_EPS_M);
  }

  function leaderOf(modelIds, scores, metrics){
    let winId=null, winV=Infinity;
    for(const id of modelIds){
      const s=scores[id];
      if(!s||s.canonical===false||!finite(s.leaderScore)) continue;
      const v=+s.leaderScore;
      if(v<winV-LEADER_TIE_POINTS){winV=v;winId=id;continue;}
      if(winId&&Math.abs(v-winV)<=LEADER_TIE_POINTS){
        const e=oopError(metrics[id],metrics.reference);
        const ew=oopError(metrics[winId],metrics.reference);
        if(e!=null&&(ew==null||e<ew)){winV=Math.min(winV,v);winId=id;}
      }
    }
    return winId;
  }

  return {
    TL_SHADOW,
    TL_ERR_CAP,
    RECIP_CAP,
    CONV_CAP,
    LEADER_TIE_POINTS,
    scoreModel,
    leaderOf,
    oopError,
  };
});
