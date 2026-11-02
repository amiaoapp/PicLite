// Check real export pixels against geometric subpixel coverage, and verify
// Retina preview backing does not change download size or pointer coordinates.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readdirSync,readFileSync} from 'node:fs';
import {floatingBrowser} from './helpers/floating-test-browser.mjs';
const origin=process.env.ORIGIN||'http://127.0.0.1:1551';
const artifacts=process.env.ARTIFACTS||'/tmp/piclite-cover-rounding';mkdirSync(artifacts,{recursive:true});
const downloads=artifacts+'/downloads';mkdirSync(downloads,{recursive:true});
await floatingBrowser(async({send,evaluate:ev,wait})=>{
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.clear();localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({language:'en',theme:'light'}));localStorage.setItem('piclite.cover-preset.v1',JSON.stringify({version:1,ui:{canvasW:'201',canvasH:'201',transparent:true,bgShadow:false,bgPadding:'0',bgBorderType:'none',textContent:'',innerSize:'158',borderRadius:'37',borderType:'none',enableShadow:false,zoom:'100',format:'image/png'},pos:{iconPos:{x:100.5,y:100.5},textPos:{x:100.5,y:170}},images:{bg:null}}));`});
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:2,mobile:false});
 await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
 await send('Page.navigate',{url:origin});await wait(`!!document.querySelector('[data-tool-id=banner]')`);
 await ev(`document.querySelector('[data-tool-id=banner]').click()`);await wait(`!!document.querySelector('.banner-page iframe')?.contentWindow.picLiteCover`);
 const result=await ev(`(async()=>{
  const f=document.querySelector('.banner-page iframe'),w=f.contentWindow,d=f.contentDocument;await w.picLiteCover.ready;
  const source=d.createElement('canvas');source.width=400;source.height=400;const sourceContext=source.getContext('2d');sourceContext.fillStyle='#fff';sourceContext.fillRect(0,0,400,400);
  const result=await w.picLiteCover.render(source.toDataURL());const bitmap=await createImageBitmap(result.blob);
  const output=document.createElement('canvas');output.width=bitmap.width;output.height=bitmap.height;const ctx=output.getContext('2d');ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,bitmap.width,bitmap.height).data;
  const origin=21.5,radius=37,samples=32;let error=0,count=0,maxError=0,fringe=0;
  for(let y=20;y<61;y++)for(let x=20;x<61;x++){
   let covered=0;for(let sy=0;sy<samples;sy++)for(let sx=0;sx<samples;sx++){
    const px=x+(sx+.5)/samples,py=y+(sy+.5)/samples;
    if(px>=origin&&py>=origin&&(px>=origin+radius||py>=origin+radius||(px-origin-radius)**2+(py-origin-radius)**2<=radius**2))covered++;
   }
   const expected=covered/(samples*samples),alpha=pixels[(y*bitmap.width+x)*4+3]/255;
   if(expected>0&&expected<1){const delta=Math.abs(alpha-expected);error+=delta;maxError=Math.max(maxError,delta);count++;}
   if(alpha>0&&pixels[(y*bitmap.width+x)*4]<250)fringe++;
  }
  const main=d.getElementById('mainCanvas'),b=main.getBoundingClientRect(),fr=f.getBoundingClientRect();
  return{width:bitmap.width,height:bitmap.height,backing:[main.width,main.height],css:[main.style.width,main.style.height],meanEdgeError:error/count,maxEdgeError:maxError,boundaryPixels:count,darkFringe:fringe,png:output.toDataURL().split(',')[1],point:{x:fr.x+b.x+b.width/2,y:fr.y+b.y+b.height/2}};
 })()`);
 assert.deepEqual([result.width,result.height],[201,201]);assert.deepEqual(result.css,['201px','201px']);assert.ok(result.backing[0]>=402);
 const diagnostics={...result,png:undefined};
 assert.ok(result.boundaryPixels>50);assert.ok(result.meanEdgeError<.04,JSON.stringify(diagnostics));assert.ok(result.maxEdgeError<.12,JSON.stringify(diagnostics));assert.equal(result.darkFringe,0);
 writeFileSync(artifacts+'/rounded-export.png',Buffer.from(result.png,'base64'));
 const before=new Set(readdirSync(downloads));await ev(`document.querySelector('.banner-page iframe').contentDocument.getElementById('downloadBtn').click()`);
 let downloaded;for(let n=0;n<100;n++){downloaded=readdirSync(downloads).find(p=>!before.has(p)&&p.endsWith('.png'));if(downloaded)break;await new Promise(r=>setTimeout(r,50));}
 assert.ok(downloaded,'download produced a PNG');const bytes=readFileSync(downloads+'/'+downloaded);assert.equal(bytes.readUInt32BE(16),201);assert.equal(bytes.readUInt32BE(20),201);
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',...result.point});await send('Input.dispatchMouseEvent',{type:'mousePressed',...result.point,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:result.point.x+20,y:result.point.y,button:'left',buttons:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:result.point.x+20,y:result.point.y,button:'left',clickCount:1});
 const position=await ev(`JSON.parse(localStorage.getItem('piclite.cover-preset.v1')).pos.iconPos`);assert.ok(Math.abs(position.x-120.5)<1,JSON.stringify(position));assert.ok(Math.abs(position.y-100.5)<1);
 delete result.png;writeFileSync(artifacts+'/report.json',JSON.stringify({status:'passed',...result,downloaded,pointerPosition:position},null,2));
 console.log('PASS cover corner coverage',JSON.stringify({mean:result.meanEdgeError,max:result.maxEdgeError,boundaryPixels:result.boundaryPixels,backing:result.backing,output:[201,201],pointer:position}));
});
