/** Only immutable built-in content may cross the normal organization read boundary. */
export const LIBRARY_ORG = '00000000-0000-4000-8000-000000000066';
export function builtInContentSql(alias: string): string {
  return `(${alias}.org_id='${LIBRARY_ORG}' AND ((${alias}.kind='pack' AND json_extract(${alias}.data,'$.isBuiltIn')=1) OR (${alias}.kind='source' AND EXISTS(SELECT 1 FROM Records library_pack WHERE library_pack.kind='pack' AND library_pack.id=${alias}.owner_id AND library_pack.org_id='${LIBRARY_ORG}' AND json_extract(library_pack.data,'$.isBuiltIn')=1))))`;
}
/** SQL view of both historic one-pack scopes and current multi-book scopes. */
export function scopeEntriesSql(alias: string): string {
  return `CASE WHEN json_type(${alias}.data,'$.packs')='array' THEN json_extract(${alias}.data,'$.packs') ELSE json_array(json_object('contentPackId',json_extract(${alias}.data,'$.contentPackId'),'includes',json_extract(${alias}.data,'$.includes'),'excludes',json_extract(${alias}.data,'$.excludes'))) END`;
}
