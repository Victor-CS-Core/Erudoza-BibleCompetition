import { ProfileAvatar } from "../profile/ProfileAvatar";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { Student } from "../../api/types";
import { Badge, Button, Input, Select } from "../../components/ui";
import "../../styles/student-table.css";

export function StudentTable({ students, renderPlan, renderActions }: {
  students: Student[];
  renderPlan?: (student: Student) => ReactNode;
  renderActions: (student: Student) => ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "";
  const status = ["active", "inactive"].includes(params.get("studentStatus") ?? "") ? params.get("studentStatus")! : "all";
  const sort = params.get("studentSort") === "desc" ? "desc" : "asc";
  const pageSize = [10, 25, 50].includes(Number(params.get("pageSize"))) ? Number(params.get("pageSize")) : 10;
  const filtered = students.filter(student => `${student.displayName} ${student.userName}`.toLowerCase().includes(search.trim().toLowerCase())
    && (status === "all" || (status === "active" ? student.isActive !== false : student.isActive === false)))
    .sort((a, b) => (sort === "desc" ? -1 : 1) * (a.displayName.localeCompare(b.displayName) || a.userId.localeCompare(b.userId)));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const requestedPage = Number(params.get("page"));
  const page = Number.isSafeInteger(requestedPage) ? Math.min(pages, Math.max(1, requestedPage)) : 1;
  const start = (page - 1) * pageSize;
  function update(values: Record<string, string>) {
    setParams(previous => { const next = new URLSearchParams(previous); Object.entries(values).forEach(([key, value]) => next.set(key, value)); return next; }, { replace: true });
  }
  return <div className="student-directory">
    <div className="student-table-tools">
      <label>Search students<Input className="ds-input-compact" type="search" placeholder="Name or username" value={search} onChange={event => update({ search: event.target.value, page: "1" })} /></label>
      <label>Status<Select className="ds-input-compact" value={status} onChange={event => update({ studentStatus: event.target.value, page: "1" })}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></Select></label>
      <label>Sort by<Select className="ds-input-compact" value={sort} onChange={event => update({ studentSort: event.target.value, page: "1" })}><option value="asc">Name A–Z</option><option value="desc">Name Z–A</option></Select></label>
      <label>Rows per page<Select className="ds-input-compact" value={pageSize} onChange={event => update({ pageSize: event.target.value, page: "1" })}>{[10, 25, 50].map(size => <option key={size} value={size}>{size}</option>)}</Select></label>
    </div>
    <div className="student-table-scroll" role="region" aria-label="Student directory table" tabIndex={0}>
      <table className="training-table student-table" data-testid="student-list">
        <caption className="sr-only">Students and their available actions</caption>
        <thead><tr><th scope="col" aria-sort={sort === "asc" ? "ascending" : "descending"}>Student</th>{renderPlan && <th scope="col">Season plan</th>}<th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
        <tbody>{filtered.slice(start, start + pageSize).map(student => <tr key={student.userId}>
          <th scope="row"><span className="profile-person"><ProfileAvatar userId={student.userId} displayName={student.displayName} /><span><strong>{student.displayName}</strong><p>{student.userName}</p></span></span></th>
          {renderPlan && <td className="student-plan-cell">{renderPlan(student)}</td>}
          <td className="student-status-cell"><Badge tone={student.isActive === false ? "neutral" : "success"}>{student.isActive === false ? "Inactive" : "Active"}</Badge></td>
          <td className="student-actions-cell"><div className="student-row-actions">{renderActions(student)}</div></td>
        </tr>)}</tbody>
      </table>
    </div>
    {!filtered.length && <p>{students.length ? status === "all" ? "No students match your search." : "No students match your search or status filter." : "No students yet."}</p>}
    <nav className="student-pagination" aria-label="Student pagination">
      <span role="status">{filtered.length ? `${start + 1}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length} students` : "0 students"}</span>
      <div><Button size="compact" variant="secondary" disabled={page === 1} onClick={() => update({ page: String(page - 1) })}>Previous</Button><span>Page {page} of {pages}</span><Button size="compact" variant="secondary" disabled={page === pages} onClick={() => update({ page: String(page + 1) })}>Next</Button></div>
    </nav>
  </div>;
}
