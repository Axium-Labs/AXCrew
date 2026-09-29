import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export function cn(...inputs:ClassValue[]){return twMerge(clsx(inputs))}
export function time(value:number|null|undefined){return value?new Date(value*1000).toLocaleString():'—'}
export function short(id:string){return id.length>14?id.slice(0,8):id}
export function readable(kind:string){return kind.replaceAll('.',' · ').replaceAll('_',' ')}
