import {HubConnectionBuilder,HubConnectionState} from "@microsoft/signalr";
import type {HubConnection} from "@microsoft/signalr";
import {apiUrl} from "./url";
import {practiceApi} from "./practice";
import type {PracticeCommand} from "./practice";
export const nativeCloudflare=import.meta.env.VITE_NATIVE_CLOUDFLARE==="true";
export type PracticeConnection=Pick<HubConnection,"state"|"start"|"stop"|"invoke"|"on"|"onreconnecting"|"onreconnected"|"onclose">;
class NativeConnection implements PracticeConnection {
 state=HubConnectionState.Disconnected;
 private socket?:WebSocket;private stopped=false;private attempts=0;private timer?:ReturnType<typeof setTimeout>;
 private changed:(()=>void)[]=[];private reconnecting:(()=>void)[]=[];private reconnected:(()=>void)[]=[];private closed:(()=>void)[]=[];
 private replies=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 constructor(private org:string,private room:string){}
 async start():Promise<void>{this.stopped=false;return this.connect(false);}
 private connect(reconnecting:boolean):Promise<void>{
  this.state=reconnecting?HubConnectionState.Reconnecting:HubConnectionState.Connecting;
  const url=new URL(apiUrl(`/api/v1/organizations/${this.org}/practice/rooms/${this.room}/socket`),location.href);url.protocol=url.protocol==="https:"?"wss:":"ws:";
  return new Promise((resolve,reject)=>{const socket=new WebSocket(url);this.socket=socket;
   socket.onopen=()=>{this.state=HubConnectionState.Connected;this.attempts=0;if(reconnecting)this.reconnected.forEach(fn=>fn());resolve();};
   socket.onerror=()=>reject(new Error("Live connection failed."));
   socket.onmessage=event=>{let data:{type:string;id?:string};try{data=JSON.parse(String(event.data));}catch{return;}if(data.type==="Changed")this.changed.forEach(fn=>fn());else if(data.id){const pending=this.replies.get(data.id);if(pending){clearTimeout(pending.timer);this.replies.delete(data.id);pending.resolve(data);}}};
   socket.onclose=()=>{reject(new Error("Live connection closed."));for(const pending of this.replies.values()){clearTimeout(pending.timer);pending.reject(new Error("Connection interrupted."));}this.replies.clear();if(this.stopped)return;if(this.attempts>=4){this.state=HubConnectionState.Disconnected;this.closed.forEach(fn=>fn());return;}this.state=HubConnectionState.Reconnecting;this.reconnecting.forEach(fn=>fn());const delay=[1000,3000,10000,30000][this.attempts++];this.timer=setTimeout(()=>{void this.connect(true).catch(()=>{});},delay);};
  });
 }
 async stop(){this.stopped=true;if(this.timer)clearTimeout(this.timer);this.socket?.close(1000);this.state=HubConnectionState.Disconnected;}
 on(name:string,handler:()=>void){if(name==="Changed")this.changed.push(handler);}
 onreconnecting(handler:()=>void){this.reconnecting.push(handler);}
 onreconnected(handler:()=>void){this.reconnected.push(handler);}
 onclose(handler:()=>void){this.closed.push(handler);}
 async invoke<T=unknown>(method:string,...args:unknown[]):Promise<T>{
  if(method==="Watch")return undefined as T;
  if(method==="Command")return await practiceApi.command(this.org,this.room,args[2] as PracticeCommand) as T;
  if(this.state!==HubConnectionState.Connected)throw new Error("Live connection is not ready.");
  const id=crypto.randomUUID();return new Promise<T>((resolve,reject)=>{const timer=setTimeout(()=>{this.replies.delete(id);reject(new Error("Connection probe timed out."));},5000);this.replies.set(id,{resolve:value=>resolve(value as T),reject,timer});this.socket!.send(JSON.stringify({type:method,id,nonce:method==="AckProbe"?args[2]:undefined}));});
 }
}
export function createPracticeConnection(org:string,room:string):PracticeConnection{return nativeCloudflare?new NativeConnection(org,room):new HubConnectionBuilder().withUrl(apiUrl("/api/v1/pvp/hub"),{withCredentials:true}).withAutomaticReconnect().build();}
