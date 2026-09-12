import type {RequestContext} from '../types';
import {HttpError} from '../types';
/** SQL candidates expose key + JSON payload. No oversized payload crosses the binding.
 * A byte-truncated page resumes by its last returned key; only an empty page is terminal. */
export async function chapterBoundedPage<T>(ctx:RequestContext,sql:string,args:(string|number|null)[]):Promise<T[]>{
 const result=await ctx.env.DB.prepare(`WITH candidates AS (${sql}), sized AS (
 SELECT key,payload,row_number() OVER(ORDER BY key) AS position,sum(length(CAST(json_quote(payload) AS BLOB))+32) OVER(ORDER BY key) AS bytes FROM candidates)
 SELECT CASE WHEN bytes<=64000 THEN payload ELSE NULL END AS payload FROM sized WHERE bytes<=64000 OR position=1 ORDER BY key LIMIT 128`).bind(...args).all<{payload:string|null}>();
 if(result.results.some(r=>r.payload===null))throw new HttpError(413,'PBE_CHAPTER_INPUT_TOO_LARGE');
 return result.results.map(r=>JSON.parse(r.payload!) as T);
}
