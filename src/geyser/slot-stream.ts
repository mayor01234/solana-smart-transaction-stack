import { EventEmitter } from 'node:events';
import type { AppConfig } from '../config.js';
import { logger } from '../logger.js';
import { ReconnectingYellowstoneStream } from './reconnecting-stream.js';
import { YellowstoneClientFactory } from './yellowstone-client.js';
export interface SlotUpdate { slot:number; parent?:number; status?:string; observedAt:number; }
export class SlotStream extends EventEmitter { private latestSlot=0; private stream?:ReconnectingYellowstoneStream; constructor(private readonly config:AppConfig){super();} getLatestSlot(){return this.latestSlot;} async start(){const factory=new YellowstoneClientFactory(this.config); this.stream=new ReconnectingYellowstoneStream(this.config,factory,()=>({...factory.baseSubscribeRequest(),slots:{client:{filterByCommitment:false}}}),'slot-stream'); this.stream.on('data',(data:any)=>{const slot=Number(data?.slot?.slot??data?.slots?.slot??0); if(!slot)return; this.latestSlot=Math.max(this.latestSlot,slot); this.emit('slot',{slot,parent:data?.slot?.parent?Number(data.slot.parent):undefined,status:data?.slot?.status,observedAt:Date.now()} satisfies SlotUpdate);}); this.stream.on('backpressure',(e)=>logger.warn(e,'Slot stream backpressure.')); this.stream.on('error',(error)=>logger.warn({error},'Slot stream error.')); await this.stream.start();} stop(){this.stream?.stop();} }
