import { useLayoutEffect, useRef, useState } from 'react';
import { containPreview } from './preview-fit';

/** Size against the current native-webview slot on every resize. No intrinsic
 * image dimensions or percent-height grid cycles participate in layout. */
export function FloatingPreviewImage({src,alt,width,height}:{src:string;alt:string;width?:number;height?:number}){
  const slot=useRef<HTMLDivElement>(null);
  const [box,setBox]=useState({width:0,height:0});
  const [decoded,setDecoded]=useState({width:0,height:0});
  useLayoutEffect(()=>{
    const node=slot.current;if(!node)return;
    const measure=()=>{const r=node.getBoundingClientRect();setBox(old=>old.width===r.width&&old.height===r.height?old:{width:r.width,height:r.height});};
    measure();const observer=new ResizeObserver(measure);observer.observe(node);window.addEventListener('resize',measure);
    return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
  },[]);
  const fit=containPreview(decoded.width||width||1,decoded.height||height||1,box.width,box.height);
  return <div ref={slot} className="floating-image-slot" data-preview-fit="contain">
    <img src={src} alt={alt} draggable={false} onLoad={event=>setDecoded({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})} style={{position:'absolute',width:fit.width,height:fit.height,left:fit.left,top:fit.top,maxWidth:'none',maxHeight:'none',minWidth:0,minHeight:0,objectFit:'contain',transform:'none'}}/>
  </div>;
}
