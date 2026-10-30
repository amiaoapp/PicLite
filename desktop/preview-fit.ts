export function containPreview(imageWidth:number,imageHeight:number,width:number,height:number){
  if(!imageWidth||!imageHeight||!width||!height)return {width:0,height:0,left:0,top:0};
  const scale=Math.min(width/imageWidth,height/imageHeight);
  const w=imageWidth*scale,h=imageHeight*scale;
  return {width:w,height:h,left:Math.max(0,(width-w)/2),top:Math.max(0,(height-h)/2)};
}
