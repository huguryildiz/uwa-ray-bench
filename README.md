<p align="center">
  <img src="harness/sonar-mark.svg" width="72" height="72" alt="">
</p>

<h1 align="center">Underwater Acoustic Ray Bench</h1>

<p align="center"><b>Five LLMs, one physics prompt, one BELLHOP3D reference solver.</b></p>
<p align="center">Trace the rays. Refract through the profile. Bounce off the seabed. Score against BELLHOP3D.</p>

<p align="center">
  <img alt="Fugu Ultra" src="https://img.shields.io/badge/FUGU_ULTRA-14152b?style=for-the-badge&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI%2BPHBhdGggZD0iTTYuNSAxMmMuOTQtMy40NiA0Ljk0LTYgOC41LTYgMy41NiAwIDYuMDYgMi41NCA3IDYtLjk0IDMuNDctMy40NCA2LTcgNnMtNy41Ni0yLjUzLTguNS02WiIgLz48cGF0aCBkPSJNMTggMTJ2LjUiIC8%2BPHBhdGggZD0iTTE2IDE3LjkzYTkuNzcgOS43NyAwIDAgMSAwLTExLjg2IiAvPjxwYXRoIGQ9Ik03IDEwLjY3QzcgOCA1LjU4IDUuOTcgMi43MyA1LjVjLTEgMS41LTEgNSAuMjMgNi41LTEuMjQgMS41LTEuMjQgNS0uMjMgNi41QzUuNTggMTguMDMgNyAxNiA3IDEzLjMzIiAvPjxwYXRoIGQ9Ik0xMC40NiA3LjI2QzEwLjIgNS44OCA5LjE3IDQuMjQgOCAzaDUuOGEyIDIgMCAwIDEgMS45OCAxLjY3bC4yMyAxLjQiIC8%2BPHBhdGggZD0ibTE2LjAxIDE3LjkzLS4yMyAxLjRBMiAyIDAgMCAxIDEzLjggMjFIOS41YTUuOTYgNS45NiAwIDAgMCAxLjQ5LTMuOTgiLz48L3N2Zz4%3D">
  <img alt="Opus 4.8 max" src="https://img.shields.io/badge/OPUS_4.8_MAX-14152b?style=for-the-badge&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2ZmZmZmZiI%2BPHBhdGggZD0ibTQuNzE0NCAxNS45NTU1IDQuNzE3NC0yLjY0NzEuMDc5LS4yMzA3LS4wNzktLjEyNzVoLS4yMzA3bC0uNzg5My0uMDQ4Ni0yLjY5NTYtLjA3MjktMi4zMzc1LS4wOTcxLTIuMjY0Ni0uMTIxNC0uNTcwNy0uMTIxNS0uNTM0My0uNzA0Mi4wNTQ2LS4zNTIyLjQ3OTctLjMyMTguNjg2LjA2MDggMS41MTc5LjEwMzIgMi4yNzY3LjE1NzggMS42NTE0LjA5NzIgMi40NDY4LjI1NWguMzg4NmwuMDU0Ni0uMTU3OS0uMTMzNi0uMDk3MS0uMTAzMi0uMDk3Mkw2Ljk3MyA5LjgzNTZsLTIuNTUtMS42ODc5LTEuMzM1Ni0uOTcxNC0uNzIyNS0uNDkxOC0uMzY0My0uNDYxNC0uMTU3OC0xLjAwNzguNjU1Ny0uNzIyNS44ODAzLjA2MDcuMjI0Ni4wNjA3Ljg5MjUuNjg2IDEuOTA2NCAxLjQ3NTQgMi40ODkzIDEuODMzNi4zNjQzLjMwMzUuMTQ1Ny0uMTAzMi4wMTgyLS4wNzI4LS4xNjQtLjI3MzMtMS4zNTM5LTIuNDQ2Ny0xLjQ0NS0yLjQ4OTMtLjY0MzUtMS4wMzItLjE3LS42MTk0Yy0uMDYwNy0uMjU1LS4xMDMyLS40Njc0LS4xMDMyLS43Mjg1TDYuMjg3LjEzMzUgNi42OTk3IDBsLjk5NTcuMTMzNi40MTkuMzY0Mi42MTkyIDEuNDE0NyAxLjAwMTggMi4yMjgyIDEuNTU0MyAzLjAyOTYuNDU1My44OTg1LjI0MjkuODMxOC4wOTEuMjU1aC4xNTc5di0uMTQ1N2wuMTI3NS0xLjcwNi4yMzY4LTIuMDk0Ny4yMzA3LTIuNjk1Ny4wNzg5LS43NTg5LjM3NjQtLjkxMDcuNzQ2OC0uNDkxOC41ODI4LjI3OTMuNDc5Ny42ODYtLjA2NjguNDQzMy0uMjg1MyAxLjg1MTctLjU1ODYgMi45MDIxLS4zNjQzIDEuOTQyOWguMjEyNWwuMjQyOS0uMjQyOS45ODM1LTEuMzA1MyAxLjY1MTQtMi4wNjQzLjcyODYtLjgxOTYuODUtLjkwNDYuNTQ2NC0uNDMxMWgxLjAzMjFsLjc1OSAxLjEyOTMtLjM0IDEuMTY1Ny0xLjA2MjUgMS4zNDc4LS44ODA0IDEuMTQxNC0xLjI2MjggMS43LS43ODkzIDEuMzYuMDcyOS4xMDkzLjE4ODItLjAxODMgMi44NTM1LS42MDcgMS41NDIxLS4yNzk0IDEuODM5Ni0uMzE1Ny44MzE4LjM4ODYuMDkxLjM5NDYtLjMyNzguODA3NS0xLjk2Ny40ODU3LTIuMzA3Mi40NjE0LTMuNDM2NC44MTM2LS4wNDI1LjAzMDQuMDQ4Ni4wNjA3IDEuNTQ4Mi4xNDU3LjY2MTguMDM2NGgxLjYyMWwzLjAxNzUuMjI0Ny43ODkyLjUyMi40NzM2LjYzNzYtLjA3OS40ODU3LTEuMjE0Mi42MTkzLTEuNjM5My0uMzg4Ni0zLjgyNS0uOTEwNy0xLjMxMTMtLjMyNzloLS4xODIydi4xMDkzbDEuMDkyOSAxLjA2ODYgMi4wMDM1IDEuODA5MiAyLjUwNzUgMi4zMzE0LjEyNzUuNTc2OC0uMzIxOC40NTU0LS4zNC0uMDQ4Ni0yLjIwMzktMS42NTc1LS44NS0uNzQ2OC0xLjkyNDYtMS42MjFoLS4xMjc1di4xN2wuNDQzMi42NDk2IDIuMzQzNiAzLjUyMTQuMTIxNCAxLjA4MDctLjE3LjM1MjEtLjYwNzEuMjEyNS0uNjY3OS0uMTIxNC0xLjM3MjEtMS45MjQ2TDE0LjM4IDE3Ljk1OWwtMS4xNDE0LTEuOTQyOC0uMTM5Ny4wNzktLjY3NCA3LjI1NTItLjMxNTYuMzcwMy0uNzI4Ni4yNzkzLS42MDcxLS40NjE0LS4zMjE4LS43NDY4LjMyMTgtMS40NzUzLjM4ODYtMS45MjQ2LjMxNTctMS41My4yODUzLTEuOTAwNC4xNy0uNjMxNC0uMDEyMS0uMDQyNS0uMTM5Ny4wMTgyLTEuNDMyOCAxLjk2NzItMi4xNzk2IDIuOTQ0Ni0xLjcyNDMgMS44NDU2LS40MTI4LjE2NC0uNzE2NC0uMzcwNC4wNjY3LS42NjE4LjQwMDgtLjU4ODkgMi4zODYtMy4wMzU3IDEuNDM4OS0xLjg4Mi45MjktMS4wODY4LS4wMDYyLS4xNTc5aC0uMDU0NmwtNi4zMzg1IDQuMTE2NC0xLjEyOTMuMTQ1Ny0uNDg1Ny0uNDU1NC4wNjA4LS43NDY3LjIzMDctLjI0MjkgMS45MDY0LTEuMzExNFoiLz48L3N2Zz4%3D">
  <img alt="GPT 5.6 Sol Ultra" src="https://img.shields.io/badge/GPT_5.6_Sol_Ultra-14152b?style=for-the-badge&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2ZmZmZmZiI%2BPHBhdGggZD0iTTIyLjI4MTkgOS44MjExYTUuOTg0NyA1Ljk4NDcgMCAwIDAtLjUxNTctNC45MTA4IDYuMDQ2MiA2LjA0NjIgMCAwIDAtNi41MDk4LTIuOUE2LjA2NTEgNi4wNjUxIDAgMCAwIDQuOTgwNyA0LjE4MThhNS45ODQ3IDUuOTg0NyAwIDAgMC0zLjk5NzcgMi45IDYuMDQ2MiA2LjA0NjIgMCAwIDAgLjc0MjcgNy4wOTY2IDUuOTggNS45OCAwIDAgMCAuNTExIDQuOTEwNyA2LjA1MSA2LjA1MSAwIDAgMCA2LjUxNDYgMi45MDAxQTUuOTg0NyA1Ljk4NDcgMCAwIDAgMTMuMjU5OSAyNGE2LjA1NTcgNi4wNTU3IDAgMCAwIDUuNzcxOC00LjIwNTggNS45ODk0IDUuOTg5NCAwIDAgMCAzLjk5NzctMi45MDAxIDYuMDU1NyA2LjA1NTcgMCAwIDAtLjc0NzUtNy4wNzI5em0tOS4wMjIgMTIuNjA4MWE0LjQ3NTUgNC40NzU1IDAgMCAxLTIuODc2NC0xLjA0MDhsLjE0MTktLjA4MDQgNC43NzgzLTIuNzU4MmEuNzk0OC43OTQ4IDAgMCAwIC4zOTI3LS42ODEzdi02LjczNjlsMi4wMiAxLjE2ODZhLjA3MS4wNzEgMCAwIDEgLjAzOC4wNTJ2NS41ODI2YTQuNTA0IDQuNTA0IDAgMCAxLTQuNDk0NSA0LjQ5NDR6bS05LjY2MDctNC4xMjU0YTQuNDcwOCA0LjQ3MDggMCAwIDEtLjUzNDYtMy4wMTM3bC4xNDIuMDg1MiA0Ljc4MyAyLjc1ODJhLjc3MTIuNzcxMiAwIDAgMCAuNzgwNiAwbDUuODQyOC0zLjM2ODV2Mi4zMzI0YS4wODA0LjA4MDQgMCAwIDEtLjAzMzIuMDYxNUw5Ljc0IDE5Ljk1MDJhNC40OTkyIDQuNDk5MiAwIDAgMS02LjE0MDgtMS42NDY0ek0yLjM0MDggNy44OTU2YTQuNDg1IDQuNDg1IDAgMCAxIDIuMzY1NS0xLjk3MjhWMTEuNmEuNzY2NC43NjY0IDAgMCAwIC4zODc5LjY3NjVsNS44MTQ0IDMuMzU0My0yLjAyMDEgMS4xNjg1YS4wNzU3LjA3NTcgMCAwIDEtLjA3MSAwbC00LjgzMDMtMi43ODY1QTQuNTA0IDQuNTA0IDAgMCAxIDIuMzQwOCA3Ljg3MnptMTYuNTk2MyAzLjg1NThMMTMuMTAzOCA4LjM2NCAxNS4xMTkyIDcuMmEuMDc1Ny4wNzU3IDAgMCAxIC4wNzEgMGw0LjgzMDMgMi43OTEzYTQuNDk0NCA0LjQ5NDQgMCAwIDEtLjY3NjUgOC4xMDQydi01LjY3NzJhLjc5Ljc5IDAgMCAwLS40MDctLjY2N3ptMi4wMTA3LTMuMDIzMWwtLjE0Mi0uMDg1Mi00Ljc3MzUtMi43ODE4YS43NzU5Ljc3NTkgMCAwIDAtLjc4NTQgMEw5LjQwOSA5LjIyOTdWNi44OTc0YS4wNjYyLjA2NjIgMCAwIDEgLjAyODQtLjA2MTVsNC44MzAzLTIuNzg2NmE0LjQ5OTIgNC40OTkyIDAgMCAxIDYuNjgwMiA0LjY2ek04LjMwNjUgMTIuODYzbC0yLjAyLTEuMTYzOGEuMDgwNC4wODA0IDAgMCAxLS4wMzgtLjA1NjdWNi4wNzQyYTQuNDk5MiA0LjQ5OTIgMCAwIDEgNy4zNzU3LTMuNDUzN2wtLjE0Mi4wODA1TDguNzA0IDUuNDU5YS43OTQ4Ljc5NDggMCAwIDAtLjM5MjcuNjgxM3ptMS4wOTc2LTIuMzY1NGwyLjYwMi0xLjQ5OTggMi42MDY5IDEuNDk5OHYyLjk5OTRsLTIuNTk3NCAxLjQ5OTctMi42MDY3LTEuNDk5N1oiLz48L3N2Zz4%3D">
  <img alt="Gemini 3.1 Pro High" src="https://img.shields.io/badge/GEMINI_3.1_PRO-14152b?style=for-the-badge&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2ZmZmZmZiI%2BPHBhdGggZD0iTTEyIDJDMTIgMiAxMy41IDguNzUgMTcuNSAxMkMxMy41IDE1LjI1IDEyIDIyIDEyIDIyQzEyIDIyIDEwLjUgMTUuMjUgNi41IDEyQzEwLjUgOC43NSAxMiAyIDEyIDJaIiAvPjxwYXRoIGQ9Ik0yIDEyQzIgMTIgOC43NSAxMC41IDEyIDYuNUMxNS4yNSAxMC41IDIyIDEyIDIyIDEyQzIyIDEyIDE1LjI1IDEzLjUgMTIgMTcuNUM4Ljc1IDEzLjUgMiAxMiAyIDEyWiIvPjwvc3ZnPg%3D%3D">
  <img alt="Fable 5 Max" src="https://img.shields.io/badge/FABLE_5_MAX-14152b?style=for-the-badge&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2ZmZmZmZiI%2BPHBhdGggZD0ibTQuNzE0NCAxNS45NTU1IDQuNzE3NC0yLjY0NzEuMDc5LS4yMzA3LS4wNzktLjEyNzVoLS4yMzA3bC0uNzg5My0uMDQ4Ni0yLjY5NTYtLjA3MjktMi4zMzc1LS4wOTcxLTIuMjY0Ni0uMTIxNC0uNTcwNy0uMTIxNS0uNTM0My0uNzA0Mi4wNTQ2LS4zNTIyLjQ3OTctLjMyMTguNjg2LjA2MDggMS41MTc5LjEwMzIgMi4yNzY3LjE1NzggMS42NTE0LjA5NzIgMi40NDY4LjI1NWguMzg4NmwuMDU0Ni0uMTU3OS0uMTMzNi0uMDk3MS0uMTAzMi0uMDk3Mkw2Ljk3MyA5LjgzNTZsLTIuNTUtMS42ODc5LTEuMzM1Ni0uOTcxNC0uNzIyNS0uNDkxOC0uMzY0My0uNDYxNC0uMTU3OC0xLjAwNzguNjU1Ny0uNzIyNS44ODAzLjA2MDcuMjI0Ni4wNjA3Ljg5MjUuNjg2IDEuOTA2NCAxLjQ3NTQgMi40ODkzIDEuODMzNi4zNjQzLjMwMzUuMTQ1Ny0uMTAzMi4wMTgyLS4wNzI4LS4xNjQtLjI3MzMtMS4zNTM5LTIuNDQ2Ny0xLjQ0NS0yLjQ4OTMtLjY0MzUtMS4wMzItLjE3LS42MTk0Yy0uMDYwNy0uMjU1LS4xMDMyLS40Njc0LS4xMDMyLS43Mjg1TDYuMjg3LjEzMzUgNi42OTk3IDBsLjk5NTcuMTMzNi40MTkuMzY0Mi42MTkyIDEuNDE0NyAxLjAwMTggMi4yMjgyIDEuNTU0MyAzLjAyOTYuNDU1My44OTg1LjI0MjkuODMxOC4wOTEuMjU1aC4xNTc5di0uMTQ1N2wuMTI3NS0xLjcwNi4yMzY4LTIuMDk0Ny4yMzA3LTIuNjk1Ny4wNzg5LS43NTg5LjM3NjQtLjkxMDcuNzQ2OC0uNDkxOC41ODI4LjI3OTMuNDc5Ny42ODYtLjA2NjguNDQzMy0uMjg1MyAxLjg1MTctLjU1ODYgMi45MDIxLS4zNjQzIDEuOTQyOWguMjEyNWwuMjQyOS0uMjQyOS45ODM1LTEuMzA1MyAxLjY1MTQtMi4wNjQzLjcyODYtLjgxOTYuODUtLjkwNDYuNTQ2NC0uNDMxMWgxLjAzMjFsLjc1OSAxLjEyOTMtLjM0IDEuMTY1Ny0xLjA2MjUgMS4zNDc4LS44ODA0IDEuMTQxNC0xLjI2MjggMS43LS43ODkzIDEuMzYuMDcyOS4xMDkzLjE4ODItLjAxODMgMi44NTM1LS42MDcgMS41NDIxLS4yNzk0IDEuODM5Ni0uMzE1Ny44MzE4LjM4ODYuMDkxLjM5NDYtLjMyNzguODA3NS0xLjk2Ny40ODU3LTIuMzA3Mi40NjE0LTMuNDM2NC44MTM2LS4wNDI1LjAzMDQuMDQ4Ni4wNjA3IDEuNTQ4Mi4xNDU3LjY2MTguMDM2NGgxLjYyMWwzLjAxNzUuMjI0Ny43ODkyLjUyMi40NzM2LjYzNzYtLjA3OS40ODU3LTEuMjE0Mi42MTkzLTEuNjM5My0uMzg4Ni0zLjgyNS0uOTEwNy0xLjMxMTMtLjMyNzloLS4xODIydi4xMDkzbDEuMDkyOSAxLjA2ODYgMi4wMDM1IDEuODA5MiAyLjUwNzUgMi4zMzE0LjEyNzUuNTc2OC0uMzIxOC40NTU0LS4zNC0uMDQ4Ni0yLjIwMzktMS42NTc1LS44NS0uNzQ2OC0xLjkyNDYtMS42MjFoLS4xMjc1di4xN2wuNDQzMi42NDk2IDIuMzQzNiAzLjUyMTQuMTIxNCAxLjA4MDctLjE3LjM1MjEtLjYwNzEuMjEyNS0uNjY3OS0uMTIxNC0xLjM3MjEtMS45MjQ2TDE0LjM4IDE3Ljk1OWwtMS4xNDE0LTEuOTQyOC0uMTM5Ny4wNzktLjY3NCA3LjI1NTItLjMxNTYuMzcwMy0uNzI4Ni4yNzkzLS42MDcxLS40NjE0LS4zMjE4LS43NDY4LjMyMTgtMS40NzUzLjM4ODYtMS45MjQ2LjMxNTctMS41My4yODUzLTEuOTAwNC4xNy0uNjMxNC0uMDEyMS0uMDQyNS0uMTM5Ny4wMTgyLTEuNDMyOCAxLjk2NzItMi4xNzk2IDIuOTQ0Ni0xLjcyNDMgMS44NDU2LS40MTI4LjE2NC0uNzE2NC0uMzcwNC4wNjY3LS42NjE4LjQwMDgtLjU4ODkgMi4zODYtMy4wMzU3IDEuNDM4OS0xLjg4Mi45MjktMS4wODY4LS4wMDYyLS4xNTc5aC0uMDU0NmwtNi4zMzg1IDQuMTE2NC0xLjEyOTMuMTQ1Ny0uNDg1Ny0uNDU1NC4wNjA4LS43NDY3LjIzMDctLjI0MjkgMS45MDY0LTEuMzExNFoiLz48L3N2Zz4%3D">
  <img alt="Vanilla JS" src="https://img.shields.io/badge/VANILLA_JS-14152b?style=for-the-badge&logo=javascript&logoColor=39ff85">
  <img alt="Raw WebGL" src="https://img.shields.io/badge/RAW_WEBGL-14152b?style=for-the-badge">
  <img alt="BELLHOP3D reference" src="https://img.shields.io/badge/%F0%9F%8C%8A_BELLHOP3D_REFERENCE-14152b?style=for-the-badge">
  <a href="https://uwa-ray-bench.vercel.app/"><img alt="Vercel" src="https://img.shields.io/badge/uwa--ray--bench.vercel.app-14152b?style=for-the-badge&logo=vercel&logoColor=white"></a>
</p>

<p align="center">
  <a href="#results">Results</a> ·
  <a href="#how-the-benchmark-works">How it works</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#running-locally">Run locally</a> ·
  <a href="#project-rules">Project rules</a>
</p>

---

<p align="center">
  <img src="docs/screenshots/cinema.png" alt="Underwater Acoustic Ray Bench — Compare view: a model panel side-by-side with the BELLHOP3D reference, live benchmark cards on top" width="100%">
</p>

## What this is

Five LLMs — **Fugu Ultra**, **Opus 4.8 (max)**, **GPT 5.6 Sol (Ultra)**,
**Gemini 3.1 Pro (High)**, and **Fable 5 (Max)** — each received the exact same
[verbatim prompt](docs/model_prompt.md) in a separate, isolated session: trace a fan of
1,271 rays from a source through a synthetic 3D ocean (depth-dependent sound-speed
profile, two offset seamounts), refract them correctly, bounce them off the sloped
seabed, and report where the sound does — and doesn't — reach.

None of the models saw each other's output, the reference implementation, or the scoring
code. Each produced one `ray_view.html`, dropped unmodified into this harness as an
opaque `<iframe>`. A real **BELLHOP3D** run (genuine 3D, not an Nx2D approximation) sits
alongside them as the reference solver — not "ground truth," and not the sole verdict:
scoring separates field, coverage, and geometry fidelity (see [Results](#results)).

The harness scores every panel the same way: each one posts its own computed
transmission-loss (TL) field on an identical 101×49×31 grid, and the harness compares
that field to BELLHOP3D. **Comparison is on data, not pixels** — the models can render
however they like; the verdict comes from the numbers they export.

## Results

Scoring separates three fidelity questions instead of collapsing them into one
number — see [docs/benchmark_spec.md § Scoring note](docs/benchmark_spec.md#scoring-note)
for the full formulas. This section reports the latest canonical (41×31) run:

| Rank | Model | Composite | Field | Coverage |
| :---: | --- | ---: | ---: | ---: |
| 🥇 | **GPT 5.6 Sol (Ultra)** | **71.3** \* | 62.8 | 96.7 |
| 🥈 | **Sakana Fugu (Ultra)** | 66.8 \* | 57.4 | 95.0 |
| 🥉 | **Fable 5 (Max)** | 64.0 \* | 57.2 | 84.5 |
| 4 | **Opus 4.8 (max)** | 56.4 \* | 46.8 | 85.1 |
| 5 | **Gemini 3.1 Pro (High)** | 35.4 \* | 32.0 | 45.7 |

*0–100, higher wins. `*` = **provisional composite**: Geometry Fidelity is "not
yet scored" for every panel today because the reference panel doesn't currently
emit its own out-of-plane deflection — Composite's weight
re-normalizes over Field + Coverage only until that's fixed. Since Geometry
Fidelity itself has no leader to show, the table below reports **Boundary Δ**
(shadow-boundary position error vs BELLHOP3D, computed straight from each
panel's own TL field) in its place — a real, populated diagnostic, not a
replacement for the Geometry Fidelity axis or its Composite weight. Open the
**Scorecard** tab in the live harness for the complete per-metric breakdown,
including the retained raw diagnostics (TL RMSE, TL(R), reciprocity,
convergence, insonified%, boundary distance).*

**Per-criterion leaders** — no single model wins every axis:

| Criterion | Leader |
| --- | --- |
| Field Fidelity (↑) | **GPT 5.6 Sol (Ultra)** |
| Coverage Fidelity (↑) | **GPT 5.6 Sol (Ultra)** |
| Boundary Δ (↓) | **GPT 5.6 Sol (Ultra)** |
| Composite (provisional, ↑) | **GPT 5.6 Sol (Ultra)** |
| Core err, dB (↓) | **Sakana Fugu** |
| TL RMSE, full-field, dB (↓) | **Fable 5 (Max)** |
| Smoothed err, dB (↓) | **Fable 5 (Max)** |
| TL(R) err, dB (↓) | **GPT 5.6 Sol (Ultra)** |

*Full values and the rest of the field for each criterion are in the ranking
table above and the live **Scorecard** tab.*

GPT 5.6 Sol Ultra now sweeps TL-field accuracy, coverage-mask agreement,
receiver accuracy (TL(R)), shadow-boundary position, and the overall Composite;
Fugu leads the robust core-region error; Fable leads the full-field and smoothed
diagnostics. That's the point of splitting the score: a single blended number
would have hidden this and just picked one "winner."

<p align="center">
  <img src="docs/screenshots/compare.png" alt="Underwater Acoustic Ray Bench — Overview: all five model panels and the reference rendered side by side" width="100%">
</p>

## How the benchmark works

- **Snap grid:** each panel can be explored off-canonical (5×5 = 25 elevation × azimuth
  stops), but only **41×31 is scored** — a "Reset to canonical" control always exists.
- **Shared contract:** every panel emits `postMessage({type:'ray_metrics', ...})` with
  its metric-card numbers and its TL field on the canonical grid. No network calls.
- **Fairness protocol:** byte-identical prompt, isolated sessions, no shared UI mockups,
  no cross-contamination between the infra build and the model outputs — the full rules
  are in [CLAUDE.md](CLAUDE.md).
- **Physics governing the task** — eikonal equation, Hamiltonian ray equations, Snell's
  law at interfaces, geometric-spreading TL — is laid out in the
  [benchmark spec](docs/benchmark_spec.md).

## Architecture

```text
                     HARNESS CHROME  (harness/index.html + harness.js)
   ┌────────┬────────┬────────┬────────-┬────────┬──────────────┐
   │ Fugu UI│ Opus UI│ GPT UI │Gemini UI│Fable UI│ Reference UI │
   │(Ultra) │(4.8max)│(5.6 SU)│(3.1 Pro)│  (5)   │ (BELLHOP3D)  │
   └────────┴────────┴────────┴────────-┴────────┴──────────────┘
     opaque <iframe>s, each rendering its own vanilla-JS + WebGL scene
```

- **Harness** (`harness/`) — the shared chrome: Overview / Compare / Scorecard
  tabs, the Simulation Control sidebar, live scoring, and the shared dark-glassmorphism
  design system.
- **Reference** (`reference/`) — renders the precomputed BELLHOP3D reference solve with the
  same visual language as the harness; data is precomputed offline per snap-grid combo
  (`reference/data/<elev>x<azim>.bin`) by `reference/bellhop3d/compute_reference.py`.
- **Models** (`models/<id>/ray_view.html`) — five opaque, untouched model outputs.
- **Tools** (`tools/`) — `perf_check.mjs`, a zero-dependency Chrome-DevTools-Protocol
  performance and regression probe (FPS, heap, live-iframe count, canonical scores vs.
  a golden baseline).

## Running locally

Everything is static — no build step, no server-side code:

```bash
# any static file server works, e.g.:
npx serve .
# → open http://localhost:3000/harness/
```

Deploys as-is to Vercel (`vercel.json` rewrites `/` → `/harness/index.html`).

## Regenerating the reference or re-scoring

```bash
# reference (genuine 3D BELLHOP3D, native arm64 Python)
python3 -c "import platform; print(platform.machine())"   # must print arm64
cd reference/bellhop3d && python3 compute_reference.py

# performance + canonical-score regression check
node tools/perf_check.mjs                 # real-GPU run against a local static server
node tools/perf_check.mjs --url <URL>      # check a deployed URL
node tools/perf_check.mjs --update-baseline
```

## Project rules

The fairness and isolation rules that keep this comparison meaningful — and the shared
design system, mobile-portrait requirements, and data contract — are documented in
[CLAUDE.md](CLAUDE.md) and [docs/benchmark_spec.md](docs/benchmark_spec.md).

---

<p align="center">© 2026 · Developed by Hüseyin Uğur Yıldız</p>
