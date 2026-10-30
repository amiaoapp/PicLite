export const TOOL_ORDER_KEY = 'piclite.toolOrder.v1';
export function mergeToolOrder(saved: string[], available: string[]): string[] {
  return [...new Set([...saved.filter(id => available.includes(id)), ...available])];
}
export function reorderTool(order: string[], source: string, target: string): string[] {
  const from=order.indexOf(source),to=order.indexOf(target);
  if(from<0||to<0||from===to)return order;
  const next=[...order];next.splice(from,1);next.splice(to,0,source);return next;
}
export function destinationAtPoint(x: number, boxes: {id:string;left:number;right:number}[]): string | undefined {
  return boxes.find(b=>x <= (b.left+b.right)/2)?.id || boxes.at(-1)?.id;
}
export function readToolOrder(): string[] {
  try { const value=JSON.parse(localStorage.getItem(TOOL_ORDER_KEY)||'[]');return Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'):[]; }
  catch{return [];}
}
