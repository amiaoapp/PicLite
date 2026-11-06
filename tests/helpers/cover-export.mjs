export const coverFixture = {version:1,ui:{canvasW:'200',canvasH:'200',transparent:true,bgShadow:false,bgPadding:'0',bgBorderType:'none',textContent:'',innerSize:'158',borderRadius:'37.5',borderType:'none',enableShadow:false,zoom:'100',format:'image/png'},pos:{iconPos:{x:100,y:100},textPos:{x:100,y:170}},images:{bg:null}};
// Runs in each real application's browser, including the production container.
export async function inspectCoverExport() {
 const frame=document.querySelector('.banner-page iframe'),w=frame.contentWindow,d=frame.contentDocument;
 await w.picLiteCover.ready;
 const source=d.createElement('canvas');source.width=400;source.height=400;
 const context=source.getContext('2d');context.fillStyle='#e61e14';context.fillRect(0,0,400,400);
 const rendered=await w.picLiteCover.render(source.toDataURL());
 const bitmap=await createImageBitmap(rendered.blob);
 const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
 const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
 const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
 let partial=0,maxError=0;
 for(let y=0;y<40;y++)for(let x=0;x<40;x++){
  let coverage=0;
  for(let sy=0;sy<32;sy++)for(let sx=0;sx<32;sx++){
   const px=x+(sx+.5)/32,py=y+(sy+.5)/32;
   if(Math.max(0,37.5-px)**2+Math.max(0,37.5-py)**2<=37.5**2)coverage++;
  }
  const alpha=pixels[((y+21)*canvas.width+x+21)*4+3];
  if(alpha>0&&alpha<255)partial++;
  maxError=Math.max(maxError,Math.abs(alpha/255-coverage/1024));
 }
 return {width:canvas.width,height:canvas.height,partial,maxError,type:rendered.blob.type};
}
