import { Select } from '../../components/ui';
import type { PbeTargetView } from '../../api/practice';
export function PbeTargetFields({targets,selectedTargetId,onSelect}:{targets:PbeTargetView[];selectedTargetId:string|null;onSelect:(id:string)=>void}) {
 return <label>Learning target<Select required value={selectedTargetId??''} onChange={e=>onSelect(e.target.value)}><option value="">Choose a declared target</option>{targets.map(t=><option key={t.id} value={t.id}>{t.label} · {t.skill}</option>)}</Select></label>;
}
