import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { lifecycleApi } from "../../api/lifecycle";
import type { LibraryBook, PackScope, PassageRange, SeasonScope, TrainingDifficulty } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, Input, LinkButton, Notice, PageHeader, Panel, Select } from "../../components/ui";
import { ConfirmationDialog } from "../../components/ui/ConfirmationDialog";
import { AppIcon } from "../../components/AppIcon";
import "../../styles/season-setup.css";
import { StudentTable } from "./StudentTable";
import { coordinates, firstRange, multiScope, orderCoordinates, passageSegments, scopePacks, segmentRanges, storedRange, withinRange } from "./passageRanges";
import type { Coordinate } from "./passageRanges";
import { chapterOptions, saveChapterAssignments } from "./chapterAssignments";
import { ChapterPicker } from "./ChapterPicker";

const steps = [{ key: "details", title: "Details", note: "Name your season" }, { key: "passages", title: "Passages", note: "Choose what to study" }, { key: "students", title: "Students", note: "Assign a personal plan" }, { key: "review", title: "Review & start", note: "Check you're ready" }] as const;
type Step = typeof steps[number]["key"];
const emptyRange: PassageRange = { bookKey: "", startChapter: 0, startVerse: 0, endChapter: 0, endVerse: 0 };
const levels: { name: TrainingDifficulty; detail: string }[] = [{ name: "Foundation", detail: "More support, smaller steps" }, { name: "Standard", detail: "Balanced recall practice" }, { name: "Advanced", detail: "Fewer clues, deeper recall" }];
const rangeLabel = (range: PassageRange) => `${range.bookKey} ${range.startChapter}:${range.startVerse}–${range.endChapter}:${range.endVerse}`;

export function SeasonWizardPage() {
  const { seasonId } = useParams();
  const [params] = useSearchParams();
  return <SeasonSetup key={`${seasonId ?? "new"}-${params.get("studentId") ?? ""}`} seasonId={seasonId} />;
}

export function SeasonAssignmentEditor({ seasonId, studentId }: { seasonId: string; studentId: string }) {
  return <SeasonSetup key={`${seasonId}-${studentId}`} seasonId={seasonId} studentId={studentId} assignmentOnly />;
}

function SeasonSetup({ seasonId, studentId, assignmentOnly = false }: { seasonId?: string; studentId?: string; assignmentOnly?: boolean }) {
  const { me } = useAuth();
  const orgId = me!.organizationId;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [confirmStart, setConfirmStart] = useState(false);
  const [lifecycleAction, setLifecycleAction] = useState<"close" | "archive" | null>(null);
  const [assignmentAction, setAssignmentAction] = useState<{ id: string; contentPackId?: string; range: PassageRange; action: "remove" | "correct" } | null>(null);
  const [name, setName] = useState("");
  const [yearLabel, setYearLabel] = useState(String(new Date().getFullYear()));
  const [scopeDraft, setScopeDraft] = useState<SeasonScope | null>(null);
  const [passageChoice, setPassageChoice] = useState("0");
  const [assignmentPackId, setAssignmentPackId] = useState("");
  const [assignmentBookKey, setAssignmentBookKey] = useState("");
  const [selectedChapters, setSelectedChapters] = useState<number[]>([]);
  const [precisePassage, setPrecisePassage] = useState(false);
  const [customRange, setCustomRange] = useState<PassageRange | null>(null);
  const [assignmentType, setAssignmentType] = useState("PrimarySpecialist");
  const [difficultyEdits, setDifficultyEdits] = useState<Record<string, TrainingDifficulty>>({});
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const library = useQuery({ queryKey: ["library", orgId], queryFn: () => api.library(orgId), retry: false });
  const students = useQuery({ queryKey: ["students", orgId], queryFn: () => api.students(orgId) });
  const season = useQuery({ queryKey: ["season", orgId, seasonId], queryFn: () => api.season(orgId, seasonId!), enabled: !!seasonId });
  const scope = useQuery({ queryKey: ["season-scope", orgId, seasonId], queryFn: () => api.seasonScope(orgId, seasonId!), enabled: !!seasonId });
  const assignments = useQuery({ queryKey: ["assignments", orgId, seasonId], queryFn: () => api.assignments(orgId, seasonId!), enabled: !!seasonId });
  const savedPacks = scopePacks(scope.data);
  const editingScope = scopeDraft ?? (scope.isSuccess && !savedPacks.some(pack => pack.includes.length) && season.data && !["Active", "Completed", "Archived"].includes(season.data.status) ? multiScope([]) : null);
  const draftPacks = scopePacks(editingScope);
  const libraryUnits = useMemo(() => new Map(library.data?.books.map(book => [book.contentPackId, coordinates(book)])), [library.data]);
  const legacyIds = [...new Set([...savedPacks, ...draftPacks].map(p => p.contentPackId))].filter(id => !libraryUnits.has(id));
  const legacySources = useQueries({ queries: legacyIds.map(id => ({ queryKey: ["source-units", orgId, id], queryFn: () => api.sourceUnits(orgId, id), enabled: !library.isPending })) });
  const unitsForPack = (id: string): Coordinate[] => libraryUnits.get(id) ?? legacySources[legacyIds.indexOf(id)]?.data ?? [];
  const eligibleUnits = (pack?: PackScope) => pack ? unitsForPack(pack.contentPackId).filter(unit => pack.includes.some(range => withinRange(unit, range)) && !pack.excludes.some(range => withinRange(unit, range))) : [];
  const selectedPack = savedPacks.find(pack => pack.contentPackId === assignmentPackId) ?? savedPacks[0];
  const assignmentBooks = [...new Set(eligibleUnits(selectedPack).map(unit => unit.bookKey))];
  const selectedBookKey = assignmentBooks.includes(assignmentBookKey) ? assignmentBookKey : assignmentBooks[0];
  const assignmentUnits = eligibleUnits(selectedPack).filter(unit => unit.bookKey === selectedBookKey);
  const allAssignmentUnits = selectedPack ? unitsForPack(selectedPack.contentPackId).filter(unit => unit.bookKey === selectedBookKey) : [];
  const availableRanges = segmentRanges(assignmentUnits, allAssignmentUnits);
  const correctionPack = savedPacks.find(pack => assignmentAction?.contentPackId ? pack.contentPackId === assignmentAction.contentPackId : pack.includes.some(range => range.bookKey === assignmentAction?.range.bookKey));
  const correctionUnits = eligibleUnits(correctionPack);
  const hasScope = savedPacks.some(pack => pack.includes.length > 0);
  const active = season.data?.status === "Active";
  const closed = season.data?.status === "Completed" || season.data?.status === "Archived";
  const statusLabel = ({ ContentReady: "Passages ready", AssignmentsReady: "Plans ready" } as Record<string, string>)[season.data?.status ?? ""] ?? season.data?.status ?? "Draft";
  const requestedStep = params.get("step");
  const step: Step = assignmentOnly ? "students" : !seasonId ? "details" : steps.some((item) => item.key === requestedStep) ? requestedStep as Step : hasScope ? "students" : "passages";
  const stepIndex = steps.findIndex((item) => item.key === step);
  const selectedStudentId = studentId ?? params.get("studentId") ?? "";
  const selectedStudent = students.data?.find((item) => item.userId === selectedStudentId);
  const studentHeading = useRef<HTMLHeadingElement>(null);
  const nextStudent = !assignmentOnly && selectedStudent
    ? students.data?.slice(students.data.findIndex(student => student.userId === selectedStudentId) + 1).find(student => student.isActive !== false)
    : undefined;
  const advanceStudent = (nextId?: string) => {
    if (!nextId) return;
    // The student-keyed editor remount clears choices and loads their saved difficulty.
    setParams(previous => { const next = new URLSearchParams(previous); next.set("studentId", nextId); return next; });
  };
  const studentAssignments = assignments.data?.filter((item) => item.studentUserId === selectedStudentId) ?? [];
  const difficulty = difficultyEdits[selectedStudentId] ?? studentAssignments[0]?.difficulty ?? "Standard";
  const assignedStudents = students.data?.filter((student) => assignments.data?.some((item) => item.studentUserId === student.userId)) ?? [];
  const assignmentRange = passageChoice === "custom" ? customRange ?? availableRanges[0] ?? emptyRange : availableRanges[Number(passageChoice)] ?? availableRanges[0] ?? emptyRange;
  const alreadyAssigned = studentAssignments.some((item) => item.type === assignmentType && rangeLabel(item) === rangeLabel(assignmentRange) && (!item.contentPackId || item.contentPackId === selectedPack?.contentPackId));
  const chapterContext = { studentId: selectedStudentId, contentPackId: selectedPack?.contentPackId ?? "", type: assignmentType };
  const chapters = chapterOptions(assignmentUnits, allAssignmentUnits, studentAssignments, chapterContext);
  const selectedBookName = library.data?.books.find(book => book.contentPackId === selectedPack?.contentPackId)?.name ?? selectedBookKey;
  const go = (next: Step) => { setMessage(""); setFormError(""); setParams({ step: next }); };
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["season", orgId, seasonId] });
    void queryClient.invalidateQueries({ queryKey: ["seasons"] });
    void queryClient.invalidateQueries({ queryKey: ["assignments", orgId, seasonId] });
    void queryClient.invalidateQueries({ queryKey: ["coverage"] });
  };
  const create = useMutation({
    mutationFn: () => api.createSeason(orgId, { name: name.trim(), yearLabel: yearLabel.trim(), ruleProfileKey: "PBE_STYLE_V1" }),
    onSuccess: (created) => { void queryClient.invalidateQueries({ queryKey: ["seasons"] }); navigate(`/admin/seasons/${created.id}?step=passages`); },
  });
  const saveScope = useMutation({
    mutationFn: (draft: SeasonScope) => api.defineScope(orgId, seasonId!, multiScope(scopePacks(draft))),
    onSuccess: (_, savedScope) => {
      queryClient.setQueryData(["season-scope", orgId, seasonId], savedScope);
      setScopeDraft(null); refresh(); go("students"); setMessage("Season passages saved. Now choose a student.");
    },
  });
  const assign = useMutation({
    mutationFn: () => api.assign(orgId, seasonId!, { studentUserId: selectedStudentId, type: assignmentType, difficulty, contentPackId: selectedPack!.contentPackId, range: assignmentRange }),
    onSuccess: (_, nextId: string | undefined) => { setMessage("Assignment saved."); refresh(); advanceStudent(nextId); },
  });
  const assignChapters = useMutation({
    retry: false,
    mutationFn: () => saveChapterAssignments({
      selectedChapters, eligible: assignmentUnits, all: allAssignmentUnits, context: chapterContext,
      readAssignments: () => api.assignments(orgId, seasonId!),
      assign: range => api.assign(orgId, seasonId!, { studentUserId: selectedStudentId, contentPackId: selectedPack!.contentPackId, type: assignmentType, difficulty, range }),
    }),
    onSuccess: (result, nextId: string | undefined) => {
      if (result.assignments) queryClient.setQueryData(["assignments", orgId, seasonId], result.assignments);
      setSelectedChapters(result.remainingChapters);
      setMessage(result.completedChapters.length ? `Assigned ${selectedBookName} chapters ${result.completedChapters.join(", ")} to ${selectedStudent?.displayName}.` : "");
      setFormError(result.error ? `${result.error.message} Saved assignments are preserved. ${result.remainingChapters.length ? "Remaining chapters are still selected; retry when ready." : "Review the saved assignments below."}` : "");
      refresh();
      if (!result.error && !result.remainingChapters.length) advanceStudent(nextId);
    },
  });
  const saveDifficulty = useMutation({
    mutationFn: () => api.setDifficulty(orgId, seasonId!, selectedStudentId, difficulty),
    onSuccess: () => { setMessage("Difficulty saved for future sessions."); refresh(); },
  });
  const activate = useMutation({
    mutationFn: () => api.activate(orgId, seasonId!),
    onSuccess: (result) => { if (result.activated) { setConfirmStart(false); setMessage("Season started. Students can begin their training."); refresh(); } else setFormError(result.blockingProblems.join(" ")); },
  });
  const changeLifecycle = useMutation({
    mutationFn: () => lifecycleApi.transitionSeason(orgId, seasonId!, lifecycleAction!),
    onSuccess: () => { setMessage(lifecycleAction === "close" ? "Season closed. Study history is preserved." : "Season archived. Study history is preserved."); setLifecycleAction(null); refresh(); },
  });
  const changeAssignment = useMutation({
    mutationFn: () => assignmentAction!.action === "remove"
      ? lifecycleApi.removeAssignment(orgId, seasonId!, assignmentAction!.id)
      : lifecycleApi.correctAssignment(orgId, seasonId!, assignmentAction!.id, assignmentAction!.range),
    onSuccess: () => { setMessage("Assignment updated. Previous attempts and progress are preserved."); setAssignmentAction(null); refresh(); },
  });
  const busy = create.isPending || saveScope.isPending || assign.isPending || assignChapters.isPending || saveDifficulty.isPending || activate.isPending || changeLifecycle.isPending || changeAssignment.isPending;
  const submitScope = (event: FormEvent) => {
    event.preventDefault(); setFormError("");
    if (!draftPacks.length || !draftPacks.every(pack => pack.includes.length && [...pack.includes, ...pack.excludes].every(range => storedRange(range, unitsForPack(pack.contentPackId))))) { setFormError("Choose library books and valid passage ranges. Each end must follow its start."); return; }
    saveScope.mutate(structuredClone(editingScope!));
  };
  const submitAssignment = (event: FormEvent) => { event.preventDefault(); if (busy || closed) return; assign.reset(); assignChapters.reset(); setFormError(""); setMessage(""); const nextId = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("data-next-student") ?? undefined; if (!precisePassage) { if (selectedChapters.length && selectedStudent && selectedPack) assignChapters.mutate(nextId); return; } if (!selectedPack || !storedRange(assignmentRange, assignmentUnits, allAssignmentUnits)) { setFormError("Choose a passage entirely within the saved season scope."); return; } assign.mutate(nextId); };
  const editScope = () => setScopeDraft(multiScope(structuredClone(savedPacks)));
  const loading = !!seasonId && (season.isPending || scope.isPending || assignments.isPending || students.isPending || library.isPending || legacySources.some(query => query.isPending));
  useEffect(() => { if (!loading && selectedStudentId) studentHeading.current?.focus(); }, [loading, selectedStudentId]);
  const assignmentDisabled = busy || closed || selectedStudent?.isActive === false || !selectedStudentId || (precisePassage ? alreadyAssigned || !storedRange(assignmentRange, assignmentUnits, allAssignmentUnits) : !chapters.some(chapter => selectedChapters.includes(chapter.chapter) && chapter.remaining.length));
  const completedSteps = [!!season.data, hasScope, assignedStudents.length > 0, active];
  const queryFailed = season.isError || scope.isError || assignments.isError || students.isError;
  const errors = [create.error, saveScope.error, assign.error, assignChapters.error, saveDifficulty.error, confirmStart ? null : activate.error].filter(Boolean);

  return <div className="season-setup">
    {!assignmentOnly && <><LinkButton variant="ghost" size="compact" className="season-back" to="/admin/seasons">← All seasons</LinkButton>
    <PageHeader title={seasonId ? season.data?.name ?? "Season setup" : "Create a season"} description="Choose the season passages and assign them to your students." action={season.data && <Badge tone={active ? "success" : "neutral"} data-testid="season-status">{statusLabel}</Badge>} />
    <nav className="season-steps" aria-label="Season setup steps">{steps.map((item, index) => <Button variant={step === item.key ? "secondary" : "ghost"} key={item.key} type="button" aria-current={step === item.key ? "step" : undefined} disabled={busy || (!seasonId && index > 0) || (!!scopeDraft && item.key !== "passages")} onClick={() => go(item.key)}>
      <span className="sr-only">Step {index + 1}: </span><Badge tone={completedSteps[index] ? "success" : step === item.key ? "info" : "neutral"} className="season-step-number" aria-hidden="true">{completedSteps[index] ? "✓" : index + 1}</Badge>
      <span><strong>{item.title}</strong><small>{item.note}{completedSteps[index] && <span className="sr-only"> · Complete</span>}</small></span>
    </Button>)}</nav></>}

    {library.isError && <Notice tone="danger">{library.error.message} Existing saved passages remain available. <Button variant="secondary" onClick={() => void library.refetch()}>Retry library</Button></Notice>}
    {legacySources.some(query => query.isError) && <Notice tone="danger">Stored passages could not load. <Button variant="secondary" onClick={() => legacySources.forEach(query => void query.refetch())}>Retry passages</Button></Notice>}
    {message && <Notice tone="success">{message}</Notice>}

    {formError && !confirmStart && <Notice tone="danger">{formError}</Notice>}
    {errors.map((error, index) => <Notice tone="danger" key={index}>{error!.message}</Notice>)}
    {queryFailed ? <Notice tone="danger">Your season information could not load. <Button type="button" variant="secondary" onClick={() => { void season.refetch(); void scope.refetch(); void assignments.refetch(); void library.refetch(); void students.refetch(); }}>Try again</Button></Notice> : loading ? <Notice>Loading your saved season…</Notice> : <>
      {step === "details" && <Panel className="season-details"><div className="season-section-heading"><h2>Give your season a name</h2><p>A clear name helps your students find the right training plan.</p></div>{seasonId ? <><dl className="season-details-list"><div><dt>Season name</dt><dd>{season.data?.name}</dd></div><div><dt>Year</dt><dd>{season.data?.yearLabel}</dd></div><div><dt>Competition format</dt><dd>Bible Experience</dd></div></dl><Button  onClick={() => go("passages")}>Continue to passages →</Button></> : <form onSubmit={(event) => { event.preventDefault(); create.mutate(); }}><label>Season name<Input data-testid="season-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Daniel · Autumn 2026" required maxLength={160} /></label><div className="season-form-pair"><label>Year label<Input value={yearLabel} onChange={(event) => setYearLabel(event.target.value)} required /></label><div className="season-fixed-format"><span>Competition format</span><strong>Bible Experience</strong></div></div><p className="season-help">Your season starts as a draft. Students can begin after you review and start it.</p><Button data-testid="save-season"  disabled={create.isPending || !name.trim() || !yearLabel.trim()} type="submit">{create.isPending ? "Saving…" : "Save and choose passages"}</Button></form>}</Panel>}
      {step === "passages" && <Panel ><div className="season-section-heading"><h2>Choose season passages</h2><p>This is the season's study material. You'll give each student a passage from it next.</p></div>
        {editingScope ? <form onSubmit={submitScope} className="season-scope-form"><fieldset className="season-edit-fields" disabled={saveScope.isPending}>
          <ScopeFields packs={draftPacks} books={library.data?.books ?? []} unitsForPack={unitsForPack} onChange={packs => setScopeDraft(multiScope(packs))} />
          <div className="season-step-footer"><Button type="button" variant="secondary" onClick={() => { setScopeDraft(null); if (!hasScope) go("details"); }} disabled={saveScope.isPending}>{hasScope ? "Cancel edits" : "← Back to details"}</Button><Button data-testid="save-scope" type="submit" disabled={saveScope.isPending || !draftPacks.length || legacySources.some(query => !query.isSuccess)}>Save passages and continue →</Button></div>
        </fieldset></form> : <><ScopeSummary scope={scope.data} />{active || closed ? <p className="season-help">{closed ? "This season is closed. Saved passages and student plans are read-only." : "These passages are set for the active season. You can still adjust student plans."}</p> : <Button type="button" variant="secondary" onClick={editScope} disabled={!hasScope && !library.data?.books.length}>{hasScope ? "Edit season passages" : "Choose passages"}</Button>}{!hasScope && !library.data?.books.length && <p className="season-help">The NKJV library must be available before choosing new passages.</p>}<div className="season-step-footer"><Button type="button" variant="secondary" onClick={() => go("details")}>← Back to details</Button><Button type="button" onClick={() => go("students")} disabled={!hasScope}>Continue to students →</Button></div></>}

      </Panel>}
      {step === "students" && <>{!assignmentOnly && <div className="season-section-heading"><h2>{selectedStudentId ? "Manage assignments" : "Students"}</h2><p>{selectedStudentId ? "Manage this student's passages and training difficulty for the season." : "Find a student and open their assignments to build a personal training plan."}</p></div>}{!hasScope ? <Panel><h3>Choose season passages first</h3><p>Students need a saved passage to study.</p><LinkButton to={`/admin/seasons/${seasonId}?step=passages`}>Choose passages →</LinkButton></Panel> : !students.data?.length ? <Panel><h3>Your roster is empty</h3><p>Add students before creating their plans.</p><LinkButton to="/admin/students">Add students →</LinkButton></Panel> : !selectedStudentId ? <Panel><div className="season-editor-heading"><h3>Season roster</h3><Badge>{assignedStudents.length} / {students.data.length} assigned</Badge></div><StudentTable students={students.data} renderPlan={student => {
          const plans = assignments.data?.filter(item => item.studentUserId === student.userId) ?? [];
          return <><Badge tone={plans.length ? "success" : "neutral"}>{plans.length ? "Assigned" : "Needs a plan"}</Badge><p>{plans.length ? `${plans.length} passage${plans.length === 1 ? "" : "s"} · ${plans[0].difficulty ?? "Standard"}` : "No passages assigned"}</p></>;
        }} renderActions={student => <LinkButton size="compact" variant="secondary" to={`?${new URLSearchParams({ ...Object.fromEntries(params), step: "students", studentId: student.userId })}`} onClick={() => { setPassageChoice("0"); setCustomRange(null); setAssignmentType("PrimarySpecialist"); setMessage(""); setFormError(""); }}>Manage assignments<span className="sr-only"> for {student.displayName}</span></LinkButton>} /></Panel> : <div className="student-assignment-page">{!assignmentOnly && <Button variant="secondary" disabled={busy} onClick={() => { setMessage(""); setFormError(""); setParams(previous => { const next = new URLSearchParams(previous); next.delete("studentId"); return next; }); }}>Back to students</Button>}{!selectedStudent ? <Notice tone="danger">This student is unavailable. Return to students and choose another student.</Notice> : <>
        <Panel className="season-student-editor"><div className="season-editor-heading"><div><h2 ref={studentHeading} tabIndex={-1}>{selectedStudent?.displayName}</h2>{nextStudent && <p className="season-next-student">Next: {nextStudent.displayName}</p>}</div><Badge tone={studentAssignments.length ? "success" : "neutral"}>{studentAssignments.length ? "Assigned" : "Not assigned yet"}</Badge></div>

          <form onSubmit={submitAssignment}><fieldset className="season-edit-fields" disabled={closed || busy}>
          <label>Assignment book<Select value={selectedPack?.contentPackId ?? ""} onChange={event => { assign.reset(); assignChapters.reset(); setAssignmentPackId(event.target.value); setAssignmentBookKey(""); setSelectedChapters([]); setPrecisePassage(false); setPassageChoice("0"); setCustomRange(null); setMessage(""); setFormError(""); }}>{savedPacks.map(pack => <option key={pack.contentPackId} value={pack.contentPackId}>{library.data?.books.find(book => book.contentPackId === pack.contentPackId)?.name ?? [...new Set(pack.includes.map(range => range.bookKey))].join(", ")}</option>)}</Select></label>
          {assignmentBooks.length > 1 && <label>Book in this content<Select value={selectedBookKey ?? ""} onChange={event => { assign.reset(); assignChapters.reset(); setAssignmentBookKey(event.target.value); setSelectedChapters([]); setPassageChoice("0"); setCustomRange(null); setMessage(""); setFormError(""); }}>{assignmentBooks.map(key => <option key={key} value={key}>{key}</option>)}</Select></label>}
          <div className="season-assignment-mode"><Button variant={precisePassage ? "secondary" : "primary"} aria-pressed={!precisePassage} onClick={() => { setPrecisePassage(false); assign.reset(); assignChapters.reset(); setFormError(""); }}>Chapters</Button><Button variant={precisePassage ? "primary" : "secondary"} aria-pressed={precisePassage} onClick={() => { setPrecisePassage(true); setSelectedChapters([]); assign.reset(); assignChapters.reset(); setFormError(""); }}>Specific verses</Button></div>
          {!precisePassage ? <ChapterPicker chapters={chapters} selected={selectedChapters} onChange={setSelectedChapters} bookName={selectedBookName ?? "Book"} /> : <div className="season-precise-passage">
          <label>Passage to assign<Select value={passageChoice} onChange={(event) => { setPassageChoice(event.target.value); if (event.target.value === "custom") setCustomRange({ ...assignmentRange }); }}>{availableRanges.map((range, index) => <option key={index} value={String(index)}>{rangeLabel(range)}</option>)}<option value="custom">Choose a specific range…</option></Select></label>{passageChoice === "custom" && <RangeFields units={assignmentUnits} allUnits={allAssignmentUnits} books={library.data?.books} prefix="assignment" label="Student passage" range={assignmentRange} onChange={setCustomRange} />}
          </div>}

          <p className="season-help">Assignments use the saved season passages. Any season exclusions still apply.</p><label>Assignment role<Select value={assignmentType} onChange={(event) => { assign.reset(); assignChapters.reset(); setAssignmentType(event.target.value); setSelectedChapters([]); setMessage(""); setFormError(""); }}><option value="PrimarySpecialist">Specialist study</option><option value="RequiredCoverage">Required coverage</option></Select></label><p className="season-help">{assignmentType === "PrimarySpecialist" ? "This student’s focus passage." : "Shared passages for the whole team to study."}</p>
          <fieldset className="season-difficulty"><legend>Training difficulty</legend><p>One setting for this student throughout this season.</p><div className="season-difficulty-options">{levels.map((level) => <label key={level.name} className="ds-choice"><Input type="radio" name="difficulty" value={level.name} checked={difficulty === level.name} onChange={() => setDifficultyEdits((edits) => ({ ...edits, [selectedStudentId]: level.name }))} aria-label={level.name} /><strong>{level.name}</strong><small>{level.detail}</small></label>)}</div></fieldset>
          <DifficultyPreview difficulty={difficulty} /><Panel as="div" className="season-assignment-save"><Button data-testid="assign-student" type="submit" disabled={assignmentDisabled}>{assignChapters.isPending || assign.isPending ? "Saving assignments…" : precisePassage ? "Add passage assignment" : "Assign chapters"}</Button>{nextStudent && <Button variant="secondary" type="submit" data-next-student={nextStudent.userId} disabled={assignmentDisabled}>Save and next student</Button>}</Panel><div className="season-actions">{studentAssignments.length > 0 && <Button type="button" variant="secondary" disabled={busy || closed} onClick={() => saveDifficulty.mutate()}>Save difficulty for future sessions</Button>}</div><p className="season-help">Difficulty changes apply to future sessions. Sessions already started keep their original setting.</p>{precisePassage && alreadyAssigned && <p className="season-help">This passage and role are already assigned. Choose another range to add a passage.</p>}{closed && <p className="season-help">This season is closed. Saved student plans are read-only.</p>}</fieldset></form>
          {studentAssignments.length > 0 && <div className="season-saved-assignments"><h3>Saved passages</h3><ul>{studentAssignments.map((item) => <li key={item.id}><strong>{rangeLabel(item)}</strong><span>{item.type === "PrimarySpecialist" ? "Specialist study" : "Required coverage"}</span><div className="season-actions"><Button variant="secondary" size="compact" disabled={busy || closed} onClick={() => { changeAssignment.reset(); setAssignmentAction({ id: item.id, contentPackId: item.contentPackId, range: { ...item }, action: "correct" }); }}>Correct passage<span className="sr-only"> {rangeLabel(item)}</span></Button><Button variant="ghost" size="compact" disabled={busy || closed} onClick={() => { changeAssignment.reset(); setAssignmentAction({ id: item.id, contentPackId: item.contentPackId, range: { ...item }, action: "remove" }); }}>Remove assignment<span className="sr-only"> {rangeLabel(item)}</span></Button></div></li>)}</ul></div>}
        </Panel></>}</div>}{!assignmentOnly && <div className="season-step-footer"><Button disabled={busy} variant="secondary" onClick={() => go("passages")}>← Back to passages</Button><Button disabled={busy}  onClick={() => go("review")}>Review season →</Button></div>}</>}
      {step === "review" && <Panel  data-testid="season-review"><div className="season-section-heading"><h2>{closed ? "Season " + statusLabel.toLowerCase() : active ? "Your season is underway" : "Ready to start?"}</h2><p>{closed ? "Review the saved passages and student plans for this season." : active ? "Keep student plans up to date as your team makes progress." : "Check the passages and student plans before opening training."}</p></div><div className="season-review-grid"><div><h3>Season passages</h3><ScopeSummary scope={scope.data} /><Button variant="ghost" size="compact" onClick={() => go("passages")}>View passages →</Button></div><div><h3>Student plans <Badge>{assignedStudents.length} / {students.data?.length ?? 0} assigned</Badge></h3>{assignedStudents.length ? <ul className="season-review-roster">{assignedStudents.map((student) => { const plans = assignments.data!.filter((item) => item.studentUserId === student.userId); return <li key={student.userId}><div><strong>{student.displayName}</strong><Badge tone="info">{plans[0].difficulty ?? "Standard"}</Badge></div><p>{plans.map(rangeLabel).join(" · ")}</p></li>; })}</ul> : <p className="season-help">No students have a passage yet.</p>}<Button variant="ghost" size="compact" onClick={() => go("students")}>Manage student plans →</Button></div></div>{!active && !closed && <Notice>
          {!hasScope ? "Choose and save the season passages before starting." : !assignedStudents.length ? "Assign a passage to at least one student before starting." : `${assignedStudents.length} student${assignedStudents.length === 1 ? " is" : "s are"} ready to train.`}
          {hasScope && assignedStudents.length > 0 && assignedStudents.length < (students.data?.length ?? 0) && " Students without assignments can be added later."}
        </Notice>}<div className="season-step-footer"><Button variant="secondary" onClick={() => go("students")}>← Back to students</Button></div><div className="season-start-panel"><div><strong>{closed ? "This season is closed" : active ? "Training is open" : "Start when your team is ready"}</strong><p>{closed ? "Create a new season when your team is ready to begin again." : active ? "Students can practice, review, and rehearse." : "Starting makes this season available to assigned students."}</p></div>{closed ? <LinkButton variant="secondary" to="/admin/seasons">All seasons →</LinkButton> : active ? <LinkButton to="/admin">Go to coach overview →</LinkButton> : <Button data-testid="activate-season"  disabled={!hasScope || !assignedStudents.length || activate.isPending} onClick={() => { setFormError(""); activate.reset(); setConfirmStart(true); }}>{activate.isPending ? "Starting…" : "Start season"}</Button>}</div></Panel>}
    </>}
    {!assignmentOnly && season.data && season.data.status !== "Archived" && <div className="season-lifecycle-actions">
      {active && <Button size="compact" variant="secondary" disabled={busy} onClick={() => { changeLifecycle.reset(); setLifecycleAction("close"); }}>Close season</Button>}
      <Button size="compact" variant="ghost" disabled={busy} onClick={() => { changeLifecycle.reset(); setLifecycleAction("archive"); }}>Archive season</Button>
    </div>}
    {confirmStart && <ConfirmationDialog title={`Start ${season.data?.name ?? "this season"}?`} description="Assigned students will be able to begin training. Season passages will be locked; you can still adjust student assignments and difficulty."
      confirmLabel="Start season" pendingLabel="Starting…" pending={activate.isPending} error={formError || activate.error?.message}
      onCancel={() => { setConfirmStart(false); setFormError(""); activate.reset(); }} onConfirm={() => { setFormError(""); activate.mutate(); }} />}
    {lifecycleAction && <ConfirmationDialog title={`${lifecycleAction === "close" ? "Close" : "Archive"} ${season.data?.name}?`}
      description="Students will no longer be able to study this season, including cards already opened. Saved assignments, attempts and progress are preserved. This season cannot be reopened."
      confirmLabel={lifecycleAction === "close" ? "Close season" : "Archive season"} pending={changeLifecycle.isPending} error={changeLifecycle.error?.message}
      onCancel={() => setLifecycleAction(null)} onConfirm={() => changeLifecycle.mutate()} />}
    {assignmentAction && <ConfirmationDialog title={assignmentAction.action === "remove" ? "Remove this assignment?" : "Correct this passage?"}
      description="Previous attempts and progress are preserved. Open cards outside the updated assignments cannot be submitted. Students can start a new session with their remaining passages."
      confirmLabel={assignmentAction.action === "remove" ? "Remove assignment" : "Save corrected passage"} pending={changeAssignment.isPending}
      disabled={assignmentAction.action === "correct" && !storedRange(assignmentAction.range, correctionUnits, correctionPack ? unitsForPack(correctionPack.contentPackId) : [])} error={changeAssignment.error?.message}
      onCancel={() => setAssignmentAction(null)} onConfirm={() => changeAssignment.mutate()}>
      {assignmentAction.action === "correct" && <RangeFields units={correctionUnits} allUnits={correctionPack ? unitsForPack(correctionPack.contentPackId) : []} prefix="correct" label="Replacement passage" range={assignmentAction.range} books={library.data?.books} onChange={range => setAssignmentAction({ ...assignmentAction, range })} />}
    </ConfirmationDialog>}
    {!assignmentOnly && <p className="season-progress-note">Step {stepIndex + 1} of 4 · {closed ? "Read-only season" : "Use Save or Add to keep your changes"}</p>}
  </div>;
}

function ScopeSummary({ scope }: { scope?: SeasonScope }) {
  const packs=scopePacks(scope), includes=packs.flatMap(pack=>pack.includes), excludes=packs.flatMap(pack=>pack.excludes);
  return <div className="season-scope-summary">{includes.length ? <><ul>{includes.map((range,index)=><li key={index}><AppIcon name="book" /><strong>{rangeLabel(range)}</strong></li>)}</ul>{excludes.length>0 && <div className="season-exclusions"><span>Excluded passages</span><ul>{excludes.map((range,index)=><li key={index}>{rangeLabel(range)}</li>)}</ul></div>}</> : <p className="season-help">No season passages saved yet.</p>}</div>;
}
function ScopeFields({packs, books, unitsForPack, onChange}: {packs: PackScope[]; books: LibraryBook[]; unitsForPack: (id:string)=>Coordinate[]; onChange:(packs:PackScope[])=>void}) {
  const [addId,setAddId]=useState("");
  const available=books.filter(book=>!packs.some(pack=>pack.contentPackId===book.contentPackId));
  const update=(index:number, value:PackScope)=>onChange(packs.map((pack,i)=>i===index?value:pack));
  return <>
    {packs.map((pack,packIndex)=>{const units=unitsForPack(pack.contentPackId);return <div className="season-range-section" key={pack.contentPackId}><div className="season-editor-heading"><h3>{books.find(book=>book.contentPackId===pack.contentPackId)?.name ?? "Saved season content"}</h3><Button type="button" variant="ghost" size="compact" onClick={()=>onChange(packs.filter((_,i)=>i!==packIndex))}>Remove book</Button></div>
      <p className="season-help">{pack.includes.map(rangeLabel).join(" · ")}{pack.excludes.length ? ` · ${pack.excludes.length} exclusion(s)` : ""}</p>
      <details className="season-advanced-passages"><summary>Advanced passage options</summary>
      {(["includes","excludes"] as const).map(kind=><div className="season-range-section" key={kind}><h3>{kind==="includes"?"Passages to include":"Passages to leave out"}</h3>{pack[kind].map((range,index)=><div className="season-range-editor" key={index}><RangeFields units={units} books={books} prefix={packIndex===0&&kind==="includes"&&index===0?"scope":packIndex+"-"+kind+"-"+index} label={(kind==="includes"?"Included":"Excluded")+" passage "+(index+1)} range={range} onChange={range=>update(packIndex,{...pack,[kind]:pack[kind].map((old,i)=>i===index?range:old)})}/><Button type="button" variant="ghost" size="compact" onClick={()=>update(packIndex,{...pack,[kind]:pack[kind].filter((_,i)=>i!==index)})}>Remove {kind==="includes"?"included":"excluded"} passage {index+1}</Button></div>)}<Button type="button" variant="secondary" disabled={!units.length} onClick={()=>{const range=firstRange(units);if(range)update(packIndex,{...pack,[kind]:[...pack[kind],range]});}}>{kind==="includes"?"+ Add another passage":"+ Add an exclusion"}</Button></div>)}
      </details>
    </div>;})}
    <div className="season-form-pair"><label>Add a library book<Select value={addId} onChange={event=>setAddId(event.target.value)}><option value="">Choose an NKJV book</option>{available.map(book=><option key={book.contentPackId} value={book.contentPackId}>{book.name}</option>)}</Select></label><Button type="button" variant="secondary" disabled={!available.some(book=>book.contentPackId===addId)} onClick={()=>{const book=available.find(book=>book.contentPackId===addId);if(!book)return;const includes=segmentRanges(coordinates(book), coordinates(book));if(includes.length){onChange([...packs,{contentPackId:book.contentPackId,includes,excludes:[]}]);setAddId("");}}}>Add book</Button></div>
  </>;
}
export function RangeFields({ prefix, label, range, onChange, books, units, allUnits = units }: { prefix: string; label: string; range: PassageRange; onChange: (range: PassageRange) => void; books?: { bookKey: string; name: string }[]; units: Coordinate[]; allUnits?: Coordinate[] }) {
  const available = orderCoordinates(units);
  const bookKeys = [...new Set(available.map(unit => unit.bookKey))];
  const book = bookKeys.includes(range.bookKey) ? range.bookKey : bookKeys[0];
  const bookUnits = available.filter(unit => unit.bookKey === book);
  const chapterOptions = [...new Set(bookUnits.map(unit => unit.chapter))];
  const startChapter = chapterOptions.includes(range.startChapter) ? range.startChapter : chapterOptions[0];
  const startVerses = [...new Set(bookUnits.filter(unit => unit.chapter === startChapter).map(unit => unit.verse))];
  const startVerse = startVerses.includes(range.startVerse) ? range.startVerse : startVerses[0];
  const segment = passageSegments(units, allUnits).find(segment => segment.some(unit => unit.bookKey === book && unit.chapter === startChapter && unit.verse === startVerse)) ?? [];
  const endUnits = segment.filter(unit => unit.chapter > startChapter || unit.chapter === startChapter && unit.verse >= startVerse);
  const endChapters = [...new Set(endUnits.map(unit => unit.chapter))];
  const endChapter = endChapters.includes(range.endChapter) ? range.endChapter : endChapters[0];
  const endVerses = [...new Set(endUnits.filter(unit => unit.chapter === endChapter).map(unit => unit.verse))];
  const endVerse = endVerses.includes(range.endVerse) ? range.endVerse : endVerses[0];
  useEffect(() => {
    if (book && startVerse !== undefined && endVerse !== undefined && (book !== range.bookKey || startChapter !== range.startChapter || startVerse !== range.startVerse || endChapter !== range.endChapter || endVerse !== range.endVerse)) onChange({ bookKey: book, startChapter, startVerse, endChapter, endVerse });
  }, [book, startChapter, startVerse, endChapter, endVerse, range, onChange]);
  const select = (key: "startChapter" | "startVerse" | "endChapter" | "endVerse", value: number) => {
    const next = { ...range, [key]: value };
    if (key === "startChapter") { next.startVerse = bookUnits.find(unit => unit.chapter === value)!.verse; next.endChapter = value; next.endVerse = next.startVerse; }
    if (key === "startVerse") { next.endChapter = startChapter; next.endVerse = value; }
    if (key === "endChapter") next.endVerse = endUnits.find(unit => unit.chapter === value)!.verse;
    onChange(next);
  };
  return <fieldset className="season-range-fields" disabled={!available.length}><legend>{label}</legend><label className="season-book-field">Book<Select data-testid={prefix + "-book"} value={book ?? ""} onChange={event => { const first = available.find(unit => unit.bookKey === event.target.value)!; onChange({ bookKey: first.bookKey, startChapter: first.chapter, startVerse: first.verse, endChapter: first.chapter, endVerse: first.verse }); }}>{!bookKeys.length && <option value="">No stored passages available</option>}{bookKeys.map(key => <option key={key} value={key}>{books?.find(item => item.bookKey === key)?.name ?? key}</option>)}</Select></label><div className="season-range-numbers">{([{ key: "startChapter", title: "Start chapter", id: "start-chapter", options: chapterOptions, value: startChapter }, { key: "startVerse", title: "Start verse", id: "start", options: startVerses, value: startVerse }, { key: "endChapter", title: "End chapter", id: "end-chapter", options: endChapters, value: endChapter }, { key: "endVerse", title: "End verse", id: "end", options: endVerses, value: endVerse }] as const).map(field => <label key={field.key}>{field.title}<Select required data-testid={prefix + "-" + field.id} value={field.value ?? ""} onChange={event => select(field.key, Number(event.target.value))}>{!field.options.length && <option value="">No verses available</option>}{field.options.map(value => <option key={value} value={value}>{value}</option>)}</Select></label>)}</div><p className="season-help">Only available chapter and verse coordinates are offered.</p></fieldset>;
}
function DifficultyPreview({ difficulty }: { difficulty: TrainingDifficulty }) {
  const examples = { Foundation: ["One missing word", "Larger chunks of four words", "Two reference choices"], Standard: ["Several words (about a quarter)", "Short chunks of two words", "Up to four reference choices"], Advanced: ["Most key words", "Individual words", "Typed book, chapter and verse"] }[difficulty];
  return <details className="season-preview" data-testid="difficulty-preview"><summary>What changes with {difficulty.toLowerCase()}?</summary><dl>{["Missing Words", "Verse Builder", "Reference Match"].map((name, index) => <div key={name}><dt>{name}</dt><dd>{examples[index]}</dd></div>)}</dl><p>Illustrative formats; available activities depend on assigned passages and season rules. Full mastery requires advanced, unaided recall.</p></details>;
}
