import type { ImageFormat, OptimisationPreset } from "./clop-types";

export function cropFromDrag(a: {x: number; y: number}, b: {x: number; y: number}, width: number, height: number) {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const x = Math.min(width - 1, Math.round(Math.min(clamp(a.x), clamp(b.x)) * width));
  const y = Math.min(height - 1, Math.round(Math.min(clamp(a.y), clamp(b.y)) * height));
  return { x, y, width: Math.max(1, Math.round(Math.max(clamp(a.x), clamp(b.x)) * width) - x), height: Math.max(1, Math.round(Math.max(clamp(a.y), clamp(b.y)) * height) - y) };
}

export function editorCompressionSettings(quality: number, format: ImageFormat): Partial<OptimisationPreset> {
  return { mode: "manual", quality: Math.max(1, Math.min(100, Math.round(quality))), format, scale: 100, preventLarger: false };
}

export type CropRect = { x:number; y:number; width:number; height:number };
export type CropCorner = "nw" | "ne" | "sw" | "se";
export function cropForAspect(width:number,height:number,aspect:number):CropRect {
  if(!aspect)return {x:0,y:0,width,height};
  const w=Math.min(width,height*aspect),h=w/aspect;
  return {x:Math.round((width-w)/2),y:Math.round((height-h)/2),width:Math.max(1,Math.round(w)),height:Math.max(1,Math.round(h))};
}
export function translateCrop(crop:CropRect,dx:number,dy:number,width:number,height:number):CropRect {
  return {...crop,x:Math.max(0,Math.min(width-crop.width,Math.round(crop.x+dx))),y:Math.max(0,Math.min(height-crop.height,Math.round(crop.y+dy)))};
}
export function resizeCrop(crop:CropRect,corner:CropCorner,p:{x:number;y:number},width:number,height:number,aspect:number):CropRect {
  const west=corner.includes('w'),north=corner.includes('n');
  const anchorX=west?crop.x+crop.width:crop.x,anchorY=north?crop.y+crop.height:crop.y;
  const maxW=west?anchorX:width-anchorX,maxH=north?anchorY:height-anchorY;
  let w=Math.max(1,Math.min(maxW,Math.abs(p.x*width-anchorX)));
  let h=Math.max(1,Math.min(maxH,Math.abs(p.y*height-anchorY)));
  if(aspect>0){w=Math.min(Math.max(w,h*aspect),maxW,maxH*aspect);h=w/aspect;}
  w=Math.max(1,Math.round(w));h=Math.max(1,Math.round(h));
  return {x:west?anchorX-w:anchorX,y:north?anchorY-h:anchorY,width:w,height:h};
}
