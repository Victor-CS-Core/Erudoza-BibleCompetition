export type WikiAudience = "Shared" | "Student" | "Coach";

export type WikiScreenshot = {
  src: string;
  srcSet?: string;
  width?: number;
  height?: number;
  alt: string;
  caption: string;
};

export type WikiSection = {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
};

export type WikiControl = {
  label: string;
  explanation: string;
};

export type WikiFaq = {
  question: string;
  answer: string;
};

export type WikiScope = "public" | "app";

export type WikiArticle = {
  id: string;
  title: string;
  audience: WikiAudience;
  scope: WikiScope;
  summary: string;
  purpose?: string;
  prerequisites?: string[];
  controls?: WikiControl[];
  savedChanges?: string[];
  permissions?: string[];
  troubleshooting?: string[];
  featureIds: string[];
  keywords: string[];
  glossary?: string[];
  links?: { label: string; to: string }[];
  sections: WikiSection[];
  steps?: string[];
  faqs?: WikiFaq[];
  screenshot?: WikiScreenshot;
  related?: string[];
};

export type WikiGroup = {
  id: string;
  title: string;
  description: string;
  articleIds: string[];
};

export type WikiSearchResult = {
  article: WikiArticle;
  score: number;
};

const screenshot = (src: string, alt: string, caption: string): WikiScreenshot => {
  // Screenshots ship as WebP with an 800px variant (all modern browsers support WebP).
  const webp = src.replace(/\.png$/, '.webp');
  const small = src.replace(/\.png$/, '-800.webp');
  return { src: webp, srcSet: `${small} 800w, ${webp} 1440w`, width: 1440, height: 900, alt, caption };
};

export const wikiArticles: WikiArticle[] = [
  {
    id: "account-access",
    title: "Account access and sign-in",
    audience: "Shared",
    scope: "public",
    summary: "Sign in, understand account types, recover coach access, and keep your workspace private.",
    purpose: "Get the right person into the right Erudoza workspace and recover access without exposing account details.",
    prerequisites: ["Have the email or username and current password for the account.", "Students need credentials supplied by a coach; coaches need a verified email for signup or recovery."],
    controls: [{ label: "Sign in", explanation: "Verifies the credential on the server and opens the Student or Coach workspace." }, { label: "Forgot password", explanation: "Starts the coach recovery flow with an email verification step." }, { label: "Account menu", explanation: "Opens profile, mode switching when permitted, and sign-out controls." }],
    savedChanges: ["A successful sign-in creates a protected browser session.", "Sign out revokes the current browser session without changing study history."],
    permissions: ["Students can access Student mode and their own training data.", "Owners and administrators can use Coach mode according to their role."],
    troubleshooting: ["If credentials are rejected, check spelling and ask a coach to confirm the username.", "Students should ask a coach to reset access; coach recovery is not a student workflow."],
    featureIds: ["account-access"],
    keywords: ["login", "sign in", "password", "credential verification", "student account", "coach account", "session"],
    glossary: ["session", "credential", "coach mode", "Student mode"],
    links: [{ label: "Open sign in", to: "/login" }],
    sections: [
      { heading: "Who signs in where", paragraphs: ["Coaches use the account they created for their club. Students use the username and password provided by a coach; students do not create a separate public account from the landing page.", "An adult owner or administrator can switch between Coach mode and Student mode when the account has that permission. A student account stays in Student mode."], bullets: ["Owner: manages the club, coaches, seasons, students, and practice.", "Administrator: manages the club workflows granted to coaches.", "Student: studies assigned Scripture, practices, reviews progress, and manages their own profile."] },
      { heading: "Credential verification", paragraphs: ["Sign-in accepts the account email or username and the account password. The server verifies the credential before opening a session. Invalid credentials use a generic message, so the page does not reveal whether a particular username exists.", "A successful session is short-lived and can be revoked when the password changes or the account is deactivated. Sign out removes the session from the current browser."] },
      { heading: "If sign-in fails", paragraphs: ["Check spelling, use the account's current password, and ask a coach to confirm the username. Coaches can use password recovery from the sign-in page. Students should ask their coach to reset access rather than using coach recovery."] },
    ],
    steps: ["Open Sign in from the landing page or a workspace link.", "Enter your email or username and password.", "Choose Sign in. Students arrive at Training HQ; adults arrive in Coach mode.", "Use the Account menu to switch modes, open your profile, or sign out when finished."],
    faqs: [
      { question: "Why do students not see Coach signup?", answer: "Club creation is an adult workflow. Students use the account their coach creates and provides." },
      { question: "Does a browser remember my password?", answer: "The browser may offer its own password manager. Erudoza does not display or store a readable password in the page." },
    ],
    related: ["coach-onboarding", "workspace-navigation", "account-privacy"],
  },
  {
    id: "coach-onboarding",
    title: "Create a club, recover access, or join as a coach",
    audience: "Coach",
    scope: "public",
    summary: "Set up a coach account, verify an email, recover a password, or accept an invitation to an existing club.",
    featureIds: ["signup"],
    keywords: ["signup", "create club", "verification code", "recovery", "join coach", "invitation"],
    links: [{ label: "Create a club", to: "/signup" }, { label: "Recover a password", to: "/forgot-password" }, { label: "Join as a coach", to: "/join-coach" }],
    sections: [
      { heading: "Create a club", paragraphs: ["Coach signup creates a club and its first adult account. Enter an email address you control, complete the security check, and verify the code delivered to that address. The club name becomes the workspace identity students and invited coaches see."] },
      { heading: "Recover a coach account", paragraphs: ["Use Forgot password from sign-in. Enter the email address on the coach account, complete the verification check, and enter the emailed code. Choose a new password that is at least eight characters and keep it private."] },
      { heading: "Join an existing club", paragraphs: ["A club owner or administrator sends a coach invitation. Open the invitation link, verify the invited email, and create the password for the new coach account. An invitation can be revoked by the sender before it is accepted."] },
    ],
    steps: ["Choose the appropriate coach flow from the sign-in page.", "Complete the email and security-check step.", "Enter the one-time verification code before it expires.", "Finish the club, recovery, or invitation form and return to Coach mode."],
    faqs: [{ question: "Can a student create a club?", answer: "No. Club creation and coach invitations are adult-only. Students should use the account their coach provides." }],
    related: ["account-access", "coaches"],
  },
  {
    id: "workspace-navigation",
    title: "Navigate the workspace",
    audience: "Shared",
    scope: "app",
    summary: "Use the header, shortcuts, breadcrumbs, account menu, pinned sections, and mode switch without losing season context.",
    featureIds: ["overview", "home", "wiki", "news"],
    keywords: ["navigation", "command center", "search", "Ctrl K", "pins", "shortcuts", "breadcrumb", "mode switch", "season context", "PBE news"],
    links: [{ label: "Open help", to: "/help" }, { label: "Open PBE news", to: "/student/news" }],
    sections: [
      { heading: "The compact header", paragraphs: ["The navy header identifies Erudoza and provides the command-center search and Account menu. The current mode is reflected by the workspace you are in, while your selected season remains part of student links when a page supports season context."] },
      { heading: "Shortcuts and pins", paragraphs: ["The shortcut row contains the sections you use most. Choose Search or press Ctrl K on Windows/Linux, or Command K on macOS, to find sections, seasons, coach-accessible students, and actions. Pin a root section for one-click access; pins are local to your account, club, and role.", "On phones, the bottom dock keeps the stable destinations visible. More opens the complete command center without changing your saved desktop pins."] },
      { heading: "PBE news", paragraphs: ["The PBE news destination carries competition updates, study material, rule updates, and announcements. The newest story leads the feed, and anything published in the last week carries a gold New badge. Every article card shows a thin art header with an icon that identifies its type at a glance, a short summary, an \"In this article\" block listing what the article covers, and deep links to its reading material — so you know what you will open before you tap. The published date, estimated read time, and original source appear on each card.", "Open an article card to read the full text with a \"Jump to the reading material\" panel whose Open buttons jump straight to the linked library chapters or documents. When the article links its original announcement, a View original announcement button appears at the end."] },
      { heading: "Breadcrumbs and return paths", paragraphs: ["Breadcrumb menus switch between related sections. Season pages expose Season & books and Assignments as contextual steps. Use the visible Back link when a focused study page intentionally reduces distractions."] },
      { heading: "Question-mark help", paragraphs: ["A question-mark icon beside a section heading opens a short explanation of that section. Tap it, or focus it and press Enter, to read the detail; tap it again, press Escape, or tap anywhere else to close it.", "Important instructions, errors, and live numbers always stay visible on the page. The tooltip holds only background detail you can look up when you want it."] },
    ],
    steps: ["Open the shortcut that matches your current task.", "Use Search when a section or season is not pinned.", "Expand a section's options when you need a child destination such as Add student or Preview Scripture.", "Use Account to open your profile, switch role mode when allowed, or sign out."],
    faqs: [{ question: "Why did a season disappear from a link?", answer: "Some routes require a season selected from the page or query string. Return to Training HQ or Seasons, choose the season, and reopen the destination." }],
    related: ["account-access", "seasons", "student-training-hq"],
  },
  {
    id: "student-training-hq",
    title: "Training HQ",
    audience: "Student",
    scope: "app",
    summary: "Start today's assigned training, see your weekly goal, review the next milestone, and choose another practice path.",
    purpose: "Give students one clear starting point for the active season and the next eligible training action.",
    prerequisites: ["Be signed in as a student or in an eligible adult Student mode.", "Have an active season and assigned Scripture when training credit is expected."],
    controls: [{ label: "Start mission", explanation: "Opens the next eligible activity for the selected season." }, { label: "Practice paths", explanation: "Quick links to the training chooser, due reviews, rehearsal, or Team Practice." }, { label: "Season selector", explanation: "Changes which saved season context the page summarizes." }, { label: "See full board", explanation: "On the Season leaderboard card, opens the full season leaderboard: every teammate assigned in the season on a podium and race-bar board, ranked by season XP, with a This week view." }, { label: "Passage picker", explanation: "The Up next card suggests the passage that needs you most; book chips and the chapter strip narrow the choice, and tapping a verse tile starts practice right away." }, { label: "Start / Practice / Review this passage", explanation: "On an assigned passage's quest row, starts a session over just that passage's verses, in the mode that fits the passage — Practice, or Review when one of its verses is due — for the selected season." }],
    savedChanges: ["Completed activity attempts and the weekly practice-day result are saved by the server.", "Changing the selected season changes the view context, not assignments."],
    permissions: ["Students can use their own Training HQ and eligible activity routes.", "Coach-owned season scope remains authoritative for student activity selection."],
    troubleshooting: ["If no mission appears, check that a season is active and chapters are assigned.", "If a save is pending, wait for the result before opening another activity."],
    featureIds: ["home"],
    keywords: ["Training HQ", "today", "mission", "weekly goal", "milestone", "assigned passage", "practice day", "student home", "leaderboard", "season leaderboard", "team leaderboard", "rank", "XP board", "passage picker", "up next", "verse tiles"],
    links: [{ label: "Open Training HQ", to: "/student" }],
    screenshot: screenshot("/wiki/training-hq.png", "Sanitized Training HQ showing an active season, assigned passage progress, weekly goal, and next milestone.", "Training HQ connects today's mission, weekly practice, and next milestone."),
    sections: [
      { heading: "What Training HQ shows", paragraphs: ["Training HQ is the student's starting point, organized into a few clear surfaces in a fixed order. At the top, your player card shows your name, your level, an XP bar that always names the next level and how much XP it takes to reach it, your streak, and the current season. Below it sit your assigned passages, then the This week board — your streak days, weekly practice goal, bonus quests and the next Achievement patch — with the season leaderboard card beside it. Each assigned passage is its own quest row: the reference as its title, a state chip — Not started, In progress, Strong, or Mastered — a progress meter counting the verses that are strong or mastered against the passage's full verse count, and one action that starts a session over just that passage's verses: Start this passage before the first practice, Practice this passage while it is under way, and Review this passage when a verse in it is due. A passage nobody has started yet reads as a quest about to start, not an empty report. When more than three passages are assigned, the panel leads with the three that need you next — a passage with a review due first, then one already under way, then untouched passages, with strong and mastered ones last — and a Show all button opens the rest right there; Show less folds them away again. Directly under This week sits your training assignment card: today's steps are progress meters, and when reviews are due, one mission row carries the count and the Start due reviews button together. That count is today's review set, up to 8 passages — if more are due, the rest stay due for a later day, while the passage picker below still marks every due passage. Start due reviews opens that set as a Memory review, even in a PBE season: the count tracks the passages you learned coming due, while PBE questions are reviewed from chapter progress instead. If nothing is ready to start, the card says why; adults choosing their own passages get My assignments as the single action. Your totals and recent attempts live together in the collapsed Your activity so far section under the assignment card — open it when you want the numbers; its Due reviews tile shows the same up-to-8 count. Each bonus quest tracks its steps as segments that fill in gold as you finish them, and a summary row at the foot of the This week board counts the finished quests toward the +25 XP triple bonus. In a PBE season, your chapter journey and the passage picker follow, and a Season cooperation card sits at the bottom, closed until you open it.", "A completed day remains saved. Missing a day does not erase saved progress; the weekly count starts fresh each week according to the displayed week and target. A paused streak shows right on the player card's streak chip: practice today to restart it.", "On a phone, once you scroll past the player card, a slim strip stays at the top of the screen with your profile picture, your first name, your level and a small XP bar, so your progress stays in sight while you browse your passages; scroll back to the top and the strip gives way to the full player card."] },
      { heading: "Choose your next action", paragraphs: ["The primary action opens the next eligible activity. Practice paths links to the training chooser, due reviews, rehearsal, or Team Practice when those paths are available. The page explains when no assignment or active season is available.", "On a phone, the day's primary action stays docked in a bar at the bottom of the screen, just above the tab bar, so it is always within thumb reach; the assignment card itself keeps the secondary links. The weekly goal editor opens as a sheet that slides up from the bottom of the screen — drag a sheet down from its top edge to close it, or use its Close button."] },
      { heading: "Pick a passage to practice", paragraphs: ["The passage picker is the one place on Training HQ for choosing a passage. Its Up next card suggests the passage that needs you most — a review that is due first, otherwise your weakest unmastered verse — and its button starts that session. Below it, book chips (shown when more than one book is assigned) and a chapter strip narrow the choice, and the verse tiles show where each verse stands: a teal tile with a check is mastered, a teal tint is strong, a coral ring means a review is due, the small bar shows how strong a verse is getting, and a plain tile has not been started. Tapping a tile starts a session over that verse alone right away — a Memory review session when that verse is due, practice otherwise.", "On a phone, the picker opens from the Browse passages button as a sheet that slides up from the bottom of the screen; on a larger screen it sits on the page. Drag the sheet down from its top edge to close it without choosing. The Up next card, chips, strip, and tiles work the same in both.", "Opening Passage details under the tiles shows the selected chapter's totals, each passage's level and skill breakdown, and any review due dates."] },
      { heading: "Assignment scope matters", paragraphs: ["Training activities draw from the assigned Scripture scope and difficulty chosen by the coach. General Scripture reading does not award training credit unless it is part of an eligible activity."] },
      { heading: "Season leaderboard", paragraphs: ["There is one leaderboard: the season board. The card on Training HQ is that board at small size — the top three, your own position with the XP gap to the teammate directly above you, and a quiet line showing how many teammates practiced this week. See full board opens the leaderboard page, where the top three stand on a stepped podium — gold, navy and bronze blocks, the winner's block tallest in the middle, each student's picture on top of their block with their name, XP and rank number on the block front — and every row carries a race bar scaled to the leader, so the board reads as a race. The page can switch between season XP and a This week view. Your pinned player card shows your rank, your XP bar toward the next level, and the chase gap to the person above you in the view you picked.", "Names appear as first name plus last initial, and joining or hiding yourself is always your choice. Each podium spot and row shows the picture that student picked for their profile — their character or an Achievement patch — or their initials when they have not picked one. Before anyone has scored, there is no podium yet: the board shows a starting-line card with your teammates listed by name and level, each at 0 XP — the race is about to start, and the first practice session takes the top spot. Once one or two teammates have scored, they stand on the podium and the spots nobody has claimed yet wait beside them as plain open spots."] },
    ],
    steps: ["Choose the active season if more than one is available.", "Read the mission steps and begin the primary action.", "Complete the requested activity and follow the result link to your recap.", "Use Practice paths to choose a training mode, start due reviews, rehearse, or join Team Practice."],
    related: ["study-and-practice", "review-and-recap", "progress"],
  },
  {
    id: "study-and-practice",
    title: "Study and individual practice",
    audience: "Student",
    scope: "app",
    summary: "Choose your training — Learn, Review, or Rehearse — then answer recall prompts and receive immediate source-based feedback.",
    featureIds: ["study"],
    keywords: ["study", "practice", "recall", "answer", "feedback", "assigned Scripture", "activity", "difficulty", "learn", "review", "rehearse", "choose your training", "training format", "PBE", "Memory", "mode rules", "shuffle blanks", "shuffle deck", "spelling slip", "fix your spelling", "second chance", "session streak"],
    links: [{ label: "Open Study", to: "/student/study" }],
    screenshot: screenshot("/wiki/study-feedback.png", "Sanitized Study screen showing a fill-in-the-blank recall attempt, source feedback, and the next-card control.", "Individual practice is based on the season's assigned chapters and stored source text."),
    sections: [
      { heading: "Choose your training", paragraphs: ["Study opens on a mode-select screen with three cards, each with a distinct purpose. Learn is coached practice on the passage: all learning aids stay on, there is no timer, and feedback arrives immediately after each answer. Review is spaced repetition: it only offers passages that are actually due, stays disabled with an honest reason when nothing is due, and tells you why a passage returned — for example, when you last practiced it and your last score. Rehearse is challenge mode: Memory strips the learning aids so answers are typed from recall alone and each answer is still checked as you go, while PBE runs a shortened timed session where answers freeze when time ends and feedback waits until the finish.", "Above the cards, a training-format control chooses between PBE and Memory. The two formats are independent of the three modes: a PBE-enabled season defaults to PBE unless you pick Memory explicitly. The Review card follows the format control: in Memory its badge counts the passages you learned coming due and the start opens that Memory review; in PBE the badge counts the PBE questions due for review and the start opens the PBE review — the badge never counts one system while opening the other. Shortcuts that carry the Memory due count instead — the mission card on Training HQ, for example — say so and open the Memory review. The Scripture Library stays a separate, quiet link — reading there never starts a training session.", "A progress strip shows your real training state: current streak, level and XP progress, and your active quest when one is available. Nothing on the screen is invented — if there is no quest or no due review, the screen says so."] },
      { heading: "Mode rules at a glance", paragraphs: ["Each mode behaves the same way every time. Learn keeps every aid on: in PBE that means reading the source with assistance, in Memory it means multiple choice, the Scripture reader, and the recitation panel. The recitation panel also accepts voice input — tap to recite and speak the verse — in browsers that support it; the words land in the text box and stay editable. Nothing is timed and feedback is immediate. It needs an Active season.", "Review only ever shows passages that are actually due — when nothing is due, the card stays disabled and says so instead of starting an empty session. Feedback is immediate and nothing is timed; in PBE the source aid is not available during Review, because the point is recall. It needs an Active season and at least one due passage.", "Rehearse is challenge mode. In Memory the aids are stripped away: typed answers only, no reader, no recitation — and each answer is checked as you go. In PBE it runs a shortened timed round: answers freeze when time ends and feedback waits until the finish. It needs an Active season.", "The training-format control (PBE vs Memory) is independent of the mode: a PBE-enabled season defaults to PBE unless Memory is picked explicitly. The Review card follows the format you picked — Memory reviews your due passages, PBE reviews your due PBE questions — while count-carrying shortcuts elsewhere, like the Training HQ mission card, open the Memory review they count. Whatever you choose, reading in the Scripture Library never starts a training session and is never scored."] },
      { heading: "How a practice card works", paragraphs: ["A practice card identifies the assigned passage and presents a recall prompt. Type the answer in the provided field, then submit once. The server records the attempt and returns feedback from the stored source text.", "On a phone, the session's main buttons — Check answer, then Next card after feedback, and Finish session — stay in a bar docked at the very bottom of the screen: during a session the tab bar steps aside, so the session bar is the only bar at the bottom, and it returns as soon as the session ends. The buttons keep the same labels and the same enabled and disabled states as on a larger screen. Practice tools like Shuffle blanks and Shuffle deck stay with the card.", "Practice cards are drawn in random order, not verse by verse, so position never gives the answer away. The Shuffle deck button reshuffles the cards you have not answered yet; the card on screen stays as it is.", "On a Fill in the Blank card, Shuffle blanks does the opposite job: it keeps the same verse on screen and re-deals which words are blanked, so the pattern is fresh instead of memorized by position. Your typed draft clears, the new pattern is the one that gets checked, and you can shuffle a card's blanks up to three times. Shuffling blanks is a practice action, not help — it never marks your attempt as assisted — and it is not offered in Simulation, where the card stays fixed.", "Some activities are answered from memory: Fill in the Blank, Verse Builder, and What Comes Next. If the Assigned Scripture is open when you move to one of those cards, it hides automatically and a note explains why. Opening the passage during one of those activities restarts the attempt — your draft is cleared — and marks it as assisted, so it counts as practice rather than remembering it on your own and earns reduced credit. When you open the Assigned Scripture on a card, it opens focused on the passage that card practices — just that verse under its citation, or the next verse for What Comes Next — not the whole chapter. Browse the full chapter instead is there when you want the wider chapter, and Back to this card's passage returns to the focused verse; browsing counts as the same assisted use as the focused read. Reference Match and True/False judge material already shown on the card, so the reader may stay open for them; opening it still marks the attempt as assisted. For Reference Match the reader opens as the chapter browser rather than the focused verse, because naming the reference is the activity itself.", "Read the source reference and feedback after each answer. The goal is repeatable recall, not guessing from a displayed answer.", "Feedback shows the XP the answer earned and, on a run of correct answers, your session streak. When an answer earns XP, the amount pops up where you answered and a slim bar appears briefly at the top of the screen with your profile picture, your level, and your XP progress: the XP flies into the bar, the counter counts up, and the progress fill animates to your new total. If the answer takes you to a new level, the bar flips to that level and keeps counting the extra XP into it. The bar never blocks the next card and fades away on its own; an answer that earns no XP shows no bar. In PBE, a partial answer pops the partial amount it actually earned. If a Fill in the Blank blank is wrong only because of a small spelling slip, the feedback names it as a spelling slip, and the card offers Fix your spelling: one chance to retype just the spelling-slip blanks — blanks with a different word, or left empty, stay locked exactly as checked. A blank you correct earns partial credit — half of that blank's share of the card's XP — and counts as partial recall rather than a clean from-memory answer; your first try stays on record exactly as graded. If the retyped blank is still off, the feedback shows the verse's own spelling, and there is no second fix. Simulation cards offer no fix, so they stay exactly as checked. True/False statements stay close to the verse: a false one changes a single word of the verse itself, so read carefully. Reference Match choices are drawn from nearby references first, so they cannot be eliminated just because they come from far away. After a card is checked, the recitation panel can compare your recitation with the verse, highlighting missed and extra words — no reader trip needed. In PBE practice, feedback now highlights how each part of your answer differed from the expected wording, including spelling slips."] },
      { heading: "What the feedback score means", paragraphs: ["After each answer, the feedback line names the skill that activity measured and its score out of 100 — Exact wording for fill-in-the-blank recall, Sequence for verse ordering, Reference for reference matching, Recognition for true/false and choice questions, or Factual recall for short answers. The label matches what you just did, so a recognition question never reports an exact-wording score.", "Near-correct answers can earn partial credit: fill-in-the-blank, verse ordering, and what-comes-next questions award credit for each word in the right place, while reference matching and true/false stay all-or-nothing. Partial credit builds your skill score without counting as a fully correct answer.", "Your mastery level weighs every skill you have practiced — exact wording, sequence, reference, and recognition together. A weak skill keeps the level honest, so one strong area cannot hide another that needs work. Reviews also space out: each exact answer in a row pushes the next review further out (about 1, 3, 7, 14, then 30 days), a near-miss returns tomorrow, and a miss is due right away."] },
      { heading: "Difficulty and future sessions", paragraphs: ["Foundation, Standard, and Advanced change how future activities are selected. A session already in progress keeps the difficulty and rules it started with, so changing a plan does not rewrite an active attempt."] },
      { heading: "When an activity is unavailable", paragraphs: ["The page distinguishes no assignment, no eligible material, a completed session, and a temporary service problem. Follow the offered retry or return link rather than refreshing repeatedly while a save is pending."] },
    ],
    steps: ["Open Study from Training HQ or the workspace shortcut.", "Choose your training: Learn for coached practice, Review for due passages, or Rehearse for challenge conditions.", "Confirm the training format (PBE or Memory) if your season offers both.", "Answer the prompt and submit.", "Read the feedback, then continue or open the recap when the session finishes."],
    faqs: [{ question: "Does reading the library count as practice?", answer: "No. The library is available for reading, but training credit comes from eligible assigned activities." }, { question: "Why is Review disabled?", answer: "Review only opens when a passage is actually due. When nothing is due, the card says so instead of starting an empty session — Learn a passage to start its review cycle." }],
    related: ["scripture-library", "review-and-recap", "student-training-hq"],
  },
  {
    id: "review-and-recap",
    title: "Reviews and session recaps",
    audience: "Student",
    scope: "app",
    summary: "Return to missed material when it is due and use the recap to understand evidence from a completed session.",
    featureIds: ["review"],
    keywords: ["review", "due", "missed", "recap", "session result", "evidence", "feedback", "attempt"],
    links: [{ label: "Open due reviews", to: "/student/study?mode=Review&format=Memory" }],
    sections: [
      { heading: "Review scheduling", paragraphs: ["A missed or incorrect answer can become due for review. The review path focuses on stored evidence from your assigned material; it is not a free-form drill over the entire Bible.", "Due reviews open as a Memory review session over today's due set — up to 8 passages — even in a PBE season, because the due count tracks your learned passages coming due. Reviewing PBE questions starts from chapter progress instead.", "A review can remain due until the required recall is recorded. Review status is separate from a weekly practice-day count."] },
      { heading: "The recap", paragraphs: ["A completed session's recap centers the saved result and shows the passage evidence used by the activity. Later passage details can be opened when you want more context without losing the summary.", "The recap leads with a moment card sized to what the session earned. Ranking up or recording a milestone gets the big card — artwork, a celebration, and an XP tally receipt with the session's real numbers: correct answers, answers given, the session goal, and XP earned. A PBE recap's tally also counts partial answers — answers that earned some but not all of their points — whenever there were any. A new personal best, finishing your weekly goal, or completing quests appears as a single highlighted line. An ordinary session simply shows the tally. Nothing in the tally is estimated — every number is the session's own saved result.", "Use the recap as a study plan: note what was missed, return through Review when due, and use the assigned passage link for exact source context."] },
      { heading: "Saved evidence", paragraphs: ["Attempts, session format, and scoring rules are saved by the server. Refreshing the recap should not change the recorded result. The one planned exception is a coach's ruling on a flagged PBE answer: the recap then shows the corrected points, marked as the coach's correction, with the original points still visible. If the recap cannot load, use the retry action and avoid starting another session until you know whether the first one completed."] },
    ],
    steps: ["Open Review from Training HQ or the Study menu.", "Answer each due prompt and read the returned source feedback.", "Open the recap after the session completes.", "Use the evidence and related passage links to target your next study session."],
    related: ["study-and-practice", "progress", "honors"],
  },
  {
    id: "simulation",
    title: "PBE simulation",
    audience: "Shared",
    scope: "public",
    summary: "Choose the right rehearsal: a solo timed rehearsal that earns XP and streak credit, or a full-event team rehearsal that counts toward Simulation Achievement patches.",
    featureIds: ["simulation"],
    keywords: ["simulation", "PBE", "rehearsal", "solo timed rehearsal", "full-event team rehearsal", "Simulation Achievement patches", "Simulation honors", "XP", "streak", "one team", "two readings", "rubric", "timed", "presenter", "scribe"],
    links: [{ label: "Start a solo timed rehearsal", to: "/student/study?mode=Simulation&format=Pbe" }, { label: "Open Team Practice", to: "/student/practice" }],
    sections: [
      { heading: "Two rehearsal paths", paragraphs: ["Erudoza has two rehearsal paths. Choose the one that matches your goal.", "Solo timed rehearsal is the shortened timed practice you run alone from Study or Training HQ. It earns XP, counts toward your practice day and streak, and ends with a session recap where you can share your progress.", "Full-event team rehearsal is the one-team simulation your coach sets up as a Team Practice event. One team works through two readings with rubric points. Completing it counts toward Simulation Achievement patches. It does not award solo XP or streak credit — for those, use the solo timed rehearsal."] },
      { heading: "Set up and run", paragraphs: ["For a solo timed rehearsal, open Study and choose Simulation. The timed practice runs on assigned material and the stages advance on their own timer.", "For a full-event team rehearsal, a coach opens Team Practice and creates the event with the rehearsal options and the assigned team. Students open Team Practice, join the room from Happening now, and mark ready; the coach (or the captain the coach designated) starts. The presenter reads the question, the scribe records the team's answer, and the timed stages advance according to the room state.", "If a participant disconnects, return to the room after reconnecting. The room authority retains the current question and phase when recovery succeeds."] },
      { heading: "Scoring", paragraphs: ["PBE simulation awards rubric accuracy points for the accepted answer. Unlike Arcade practice, it does not add a speed bonus. Review the answer evidence and any coach decisions after completion."] },
      { heading: "What is saved", paragraphs: ["A completed solo rehearsal saves a session recap with your XP, personal bests, weekly-goal progress, and completed bonus quests. A completed team rehearsal saves a room recap on the room's recap page, showing your team number and score, your personal contributions, XP earned (or an honest note when the room predates XP tracking), completed quests, and season milestones.", "Simulation results are practice evidence. They do not declare an official competition placing or replace a coach's event process."] },
    ],
    steps: ["Decide whether you want solo timed rehearsal (XP and streak) or full-event team rehearsal (Simulation Achievement patches).", "For solo practice, open Study or Training HQ and choose the solo timed rehearsal.", "For team practice, your coach creates the rehearsal event; open Team Practice and join your assigned room.", "The coach (or the captain they designated) starts the rehearsal when the team is ready.", "Read each question, submit the answer, and review the saved result on the recap page."],
    faqs: [{ question: "Why is Simulation disabled?", answer: "The season may not have PBE settings or eligible material. Ask a coach to check the season and question bank." }, { question: "Does a full-event team rehearsal count toward my streak?", answer: "No. Full-event team rehearsals count toward Simulation Achievement patches. Practice days and streaks come from solo practice, including the solo timed rehearsal." }],
    related: ["team-practice", "study-and-practice", "honors"],
  },
  {
    id: "scripture-library",
    title: "Scripture Library",
    audience: "Shared",
    scope: "public",
    summary: "Browse the installed NKJV catalog, open a chapter, choose a verse, and read the stored source text.",
    featureIds: ["library", "books", "preview"],
    keywords: ["Scripture library", "NKJV", "Bible", "book", "chapter", "verse", "read", "source text", "translation", "PBE materials", "commentary", "flashcards", "year roster"],
    links: [{ label: "Open student library", to: "/student/library" }, { label: "Open coach library", to: "/admin/content" }, { label: "Open the Library tab", to: "/student/study?mode=Library" }],
    sections: [
      { heading: "Browse without changing assignments", paragraphs: ["The shared library contains the installed Bible catalog and lets coaches and students read any available book and chapter. Reading outside a student's assignment does not broaden the assignment or award practice credit.", "Books and chapters come from the installed catalog, so the page does not invent verse counts or accept coordinates that are not present in the selected translation."] },
      { heading: "This year's PBE materials", paragraphs: ["Above the Books of the Bible panel, the library shows this year's PBE materials: the competition-year badge, the book roster, and the year's Bible commentary introduction. With a season selected, the section follows that season's competition year; without a season it shows the most recent released year, clearly badged.", "Roster chips jump straight into the chapter reader. Commentary sections render in full with recall flashcards — each section becomes a card that asks what the introduction says about its heading, with a hint line and the full text on the back. Every material carries a visible View original link back to the NAD source.", "When the year's materials have not been released yet, the section shrinks to a short banner line saying so instead of showing another year's material, so the book list and reader stay near the top of the page."] },
      { heading: "Read a chapter", paragraphs: ["Search or choose a book, then choose a chapter. The reader loads the requested chapter and displays Scripture in the reading serif. On phones, once a book is chosen the book browser tucks away; the Choose book button reopens it — search included — as a sheet that slides up from the bottom of the screen, and picking a book closes the sheet and opens that book; dragging the sheet's top edge down closes it without choosing.", "The reader's controls sit in one toolbar above the text, so the chapter starts high on the screen: the previous and next chapter buttons flank the chapter picker, the verse selector jumps straight to the chosen verse as soon as you pick it, and a second row holds the text size, Focus, and Notebook controls. Focus mode keeps the chapter controls available while reducing surrounding navigation."] },
      { heading: "Assigned material", paragraphs: ["When a selected season is available, assigned chapters are highlighted as context. The library remains a general reader; coach-selected assignment scope stays authoritative in Study and assignment editors."] },
    ],
    steps: ["Open Scripture library from Search or the workspace shortcuts.", "Read this year's PBE materials at the top: roster, commentary, and flashcards.", "Search or select a book from the Old or New Testament catalog.", "Choose a chapter and optionally jump to a verse.", "Use the chapter text for reading, then return to Study for credited practice."],
    faqs: [{ question: "Can I assign verses from the library?", answer: "No. Season setup chooses whole books and assignment editors choose chapters within that saved scope. The library itself is read-only." }, { question: "Why does the PBE section show a different year than I expected?", answer: "With a season selected, the section follows that season's competition year. Without a season it shows the most recent released year, labeled with its year badge. If nothing is released for the year, it says so." }],
    screenshot: screenshot("/wiki/library-reader.png", "Sanitized coach Scripture reader showing a selected chapter and source text.", "The library keeps Scripture reading calm while assignment and season rules stay separate."),
    related: ["assignments", "study-and-practice", "seasons"],
  },
  {
    id: "assignments",
    title: "Assignments and chapter plans",
    audience: "Shared",
    scope: "app",
    summary: "Understand season scope, assign chapters, save partial plans, retry safely, and preserve student progress.",
    purpose: "Explain how coach season scope becomes each student's saved chapter plan and future activity eligibility.",
    prerequisites: ["Coaches need an editable season or permitted student assignment workflow.", "The season must contain whole books before chapters can be selected."],
    controls: [{ label: "Save assignments", explanation: "Persists the selected assignment type, difficulty, and chapter choices." }, { label: "Retry", explanation: "Reconciles confirmed server state and attempts only choices that remain unsaved." }, { label: "My assignments", explanation: "Lets an eligible account review its own saved plan in Student mode." }, { label: "Select all chapters", explanation: "Selects every chapter in the book that still has available verses." }, { label: "Refine", explanation: "Opens verse controls for one chapter so the assignment covers only chosen verse ranges." }],
    savedChanges: ["Confirmed chapter assignments, assignment type, and difficulty are saved by the server.", "Removing a future chapter changes eligibility but preserves historical attempts and progress."],
    permissions: ["Coaches can manage plans for students in their organization.", "Regular students can review their plan but cannot change coach-owned season rules."],
    troubleshooting: ["If a chapter is disabled, check the season's saved whole-book scope or whether it is already assigned.", "After a timeout, use the confirmed count and Retry instead of submitting the same save repeatedly."],
    featureIds: ["assignments", "student-assignments", "student-plans", "my-assignments", "coach-assignments", "season-assignments"],
    keywords: ["assignment", "assignments", "chapter", "chapter strip", "verse ranges", "refine verses", "save assignments", "retry", "partial", "scope", "difficulty", "student plan", "My assignments"],
    glossary: ["season scope", "whole-book scope", "chapter assignment", "future eligibility", "confirmed state"],
    links: [{ label: "Coach assignments", to: "/admin/assignments" }, { label: "Student assignments", to: "/student/assignments" }],
    sections: [
      { heading: "Two levels of scope", paragraphs: ["A coach first chooses whole books for a season. The assignment editor then chooses individual chapters inside those season books for a student. A student cannot assign chapters outside the saved season scope.", "A partial assignment is valid. It means only the selected chapters are eligible for that student's activities; it does not silently expand when the season changes."] },
      { heading: "Choose chapters from the strip", paragraphs: ["Each season book shows its eligible chapters as a compact strip. Activate a chapter to select it, drag across chapters to paint a range, or shift-click to extend from the last tapped chapter. Selected chapters collapse into range chips such as Ch 11–19, and Clear removes the whole selection.", "Already-saved chapters are locked, and chapters with limited availability (a narrowed season scope or partly assigned verses) use a dashed outline. Only chapters inside the saved season scope appear, and only verses that still exist and are still available can be chosen.", "When a season has several books, one book is shown at a time. Switch books with the tabs above the strip; each tab shows how many chapters are selected in that book, and the summary line keeps every book's pending selection visible. Switching tabs never loses a selection."] },
      { heading: "Narrow a chapter to verses", paragraphs: ["Choosing Refine verses on a selected chapter opens From and To verse fields plus Add verses. The fields offer only verses that exist in that chapter and are still available, so out-of-range values cannot be picked. Overlapping or adjacent ranges merge, and removing every range restores the whole chapter.", "Chapters narrowed to verses show a gold underline in the strip and their own chip such as 11:5–12. Unselecting a chapter clears its verse refinement."] },
      { heading: "Saving assignments", paragraphs: ["Select chapters, choose the assignment type and difficulty, then choose Save assignments. The page confirms progress as writes complete and keeps actions disabled while a save is in flight.", "If a request fails or times out, the confirmed server state is read back and the page preserves the remaining draft choices. Use Retry after checking the displayed confirmed count; do not click Save repeatedly while the first request is pending."] },
      { heading: "Student and coach views", paragraphs: ["Coaches manage an individual student's plan from the student directory, season assignments, or Assignments. A permitted adult in Student mode can use My assignments for their own learner view. Regular student accounts can review the plan but cannot change coach-owned season rules.", "Previous attempts and progress remain preserved when a chapter is removed from a future plan. A new assignment scope controls future activity selection."] },
      { heading: "Difficulty", paragraphs: ["Foundation, Standard, and Advanced apply to future sessions. An active session keeps the rules it started with, so changing an assignment does not rewrite a session already in progress."] },
    ],
    steps: ["Choose a season and confirm its whole-book scope.", "Choose a student or open My assignments when that personal workflow is available.", "Select chapters from the strip — tap, drag a range, or shift-click to extend — and optionally refine chapters to specific verse ranges.", "Choose assignment type and difficulty.", "Choose Save assignments and wait for confirmed progress.", "If the page reports a failure, review the confirmed state and use Retry for the remaining choices."],
    faqs: [
      { question: "Why can I not select a chapter?", answer: "It may be outside the season's whole-book scope, already assigned, or unavailable in the installed source catalog. Check Season & books first." },
      { question: "What does a retry do?", answer: "Retry reconciles the saved server state and attempts only the choices that remain unsaved. It should not duplicate confirmed assignments." },
    ],
    related: ["seasons", "scripture-library", "progress"],
  },
  {
    id: "seasons",
    title: "Season setup and lifecycle",
    audience: "Coach",
    scope: "app",
    summary: "Create a season, choose whole books, assign chapters, save drafts, start training, and close completed seasons.",
    purpose: "Set the club's competition season scope and lifecycle before student training begins.",
    prerequisites: ["Be signed in as an authorized coach.", "Have the intended season name, year, and installed Scripture books ready."],
    controls: [{ label: "Save as a draft", explanation: "Stores season details and selected whole books without starting training." }, { label: "Start season", explanation: "Confirms the plan, locks whole-book scope, and opens training. Enabled when at least one student has an assignment, or when you have assigned chapters to yourself as a personal study plan." }, { label: "Team Practice for your club", explanation: "Enables Team Practice events, simulations, and answer reviews across the club." }, { label: "PBE training for this season", explanation: "Unlocks PBE simulation and PBE rehearsal events for this season. PBE team practice stays locked until this is on." }, { label: "Close or archive", explanation: "Ends future training for the season after an explicit confirmation." }],
    savedChanges: ["Draft saves preserve the season name, year, status, and whole-book scope.", "Starting or closing changes lifecycle state while assignments and historical progress remain preserved."],
    permissions: ["Season creation, activation, and closing are coach workflows.", "Students can use an active season but cannot change its whole-book scope."],
    troubleshooting: ["If a next step is blocked, save or cancel unsaved scope changes first.", "If a season is already started, prepare a new season when the whole-book scope must change."],
    featureIds: ["seasons", "all-seasons", "create-season", "season-books", "details"],
    keywords: ["season", "create season", "books", "draft", "start", "activate", "close", "archive", "lifecycle", "whole books", "personal study", "my assignments"],
    glossary: ["draft", "active season", "closed season", "whole-book scope", "lifecycle"],
    links: [{ label: "Open Seasons", to: "/admin/seasons" }, { label: "Create a season", to: "/admin/seasons/new" }],
    screenshot: screenshot("/wiki/season-planning.png", "Sanitized season planner showing season details, whole-book choices, a saved draft, and the assignments step.", "Season setup begins with a name, year, and whole-book scope before student chapters are assigned."),
    sections: [
      { heading: "Step 1: season details and books", paragraphs: ["Enter a season name and year, then choose one or more whole books from the installed Scripture catalog. Whole-book selection defines the maximum scope for chapter assignments.", "Save a draft when you need to finish later. The summary shows the stored name, year, status, and selected books so you can confirm the plan before moving on."] },
      { heading: "Step 2: student assignments", paragraphs: ["Open Assignments for the season and select a student. Choose chapters inside the season books, assignment type, and difficulty. Save each plan and use the confirmed progress indicator when many chapters are selected.", "Students can be assigned different chapters within the same season. An unassigned student can still remain in the roster while the season is being prepared.", "You can also assign chapters to yourself under My assignments. A season with only your own plan is a valid personal study season — Start season works without any student assignments, and your progress stays private to you."] },
      { heading: "Starting training", paragraphs: ["Start season is an explicit action. It locks the season's whole-book scope and opens training; individual student plans can still be updated. It is enabled when at least one student has an assignment, or when you have a personal assignment of your own. Confirm the assignment count before starting.", "Until you start the season, students cannot study from their assignments. Their home shows the season and their passages with a note that training opens when the season is Active, so an assigned-but-not-started season never looks like a missing assignment."] },
      { heading: "Closing a season", paragraphs: ["Closing or archiving stops training for that season while preserving assignments, attempts, and progress history. The action cannot be reopened, so use the confirmation dialog and verify the season name before confirming."] },
    ],
    steps: ["Open Seasons and choose Create season.", "Save season details and whole-book scope as a draft.", "Open the Assignments step, select students, and save chapter plans.", "Review readiness, then explicitly Start season.", "Close or archive only when training is finished and the confirmation matches the intended season."],
    faqs: [{ question: "Can I add a new book after starting?", answer: "Starting locks the season's whole-book scope. Create or prepare a separate season if the Scripture scope needs to change." }, { question: "Can I start a season for just myself?", answer: "Yes. Assign chapters to yourself under My assignments and Start season becomes available — no student assignments are needed. Your study progress stays private; you never appear in the student directory, engagement table, or leaderboard." }],
    related: ["assignments", "student-directory", "workspace-navigation"],
  },
  {
    id: "student-directory",
    title: "Student directory and student access",
    audience: "Coach",
    scope: "app",
    summary: "Add students, find their accounts, manage active state, open plans, and inspect individual progress.",
    featureIds: ["students", "directory", "add-student"],
    keywords: ["students", "student directory", "add student", "username", "password", "active", "progress", "roster", "dashboard"],
    links: [{ label: "Open Students", to: "/admin/students" }],
    sections: [
      { heading: "Add a student", paragraphs: ["Use Add student to create the learner account with a display name, username, and initial password. Give the credentials to the student privately and ask them to sign in from the main sign-in page.", "The student directory is scoped to your club. A coach cannot use this page to manage a student from another organization."] },
      { heading: "Find a student", paragraphs: ["The directory is paginated for larger clubs. Use the search field to find a name or username instead of assuming the learner is on the first page. Open Manage assignments for the selected season or open the learner's progress.", "The Student directory and Add student links switch the page to the Directory tab and scroll to the matching section, even when the Engagement view is showing.", "Links from the coach overview can open the directory already filtered — only the students in a season who need review, or who haven't started their assigned passage. A notice at the top names the filter and how many students it caught, and its Show everyone button clears back to the full directory. The Engagement tab can likewise open with a season already chosen, and its season filter narrows the rows to that season's students."] },
      { heading: "Student dashboard", paragraphs: ["Choose Dashboard on a student's row to open a slide-over with that student's current effort, progress, assignments, mastery, team and social standing, and recent activity. The dashboard is read-only and opens beside the directory, so you can review one student and move on to the next without losing your place."] },
      { heading: "Access state", paragraphs: ["An inactive student cannot sign in or continue new training, but saved assignments and historical progress remain available to authorized coaches. Re-enable the account when the learner should return."] },
    ],
    steps: ["Open Students and review the directory.", "Use Add student for a new learner or search for an existing one.", "Open the student's dashboard for an at-a-glance summary, or their assignment plan or progress detail.", "Share credentials privately and confirm the learner can sign in."],
    faqs: [{ question: "Can I see every student's private answers?", answer: "Coach progress views show authorized training evidence for students in your club. Student-private notes and account credentials are not exposed in the directory." }],
    related: ["assignments", "progress", "coaches"],
  },
  {
    id: "coaches",
    title: "Coach directory, roles, and invitations",
    audience: "Coach",
    scope: "app",
    summary: "Invite another adult, understand club roles, resend or revoke invitations, and keep access limited to your club.",
    featureIds: ["coaches", "coach-directory", "invite-coach"],
    keywords: ["coach", "coaches", "invite", "invitation", "resend", "revoke", "owner", "administrator", "role"],
    links: [{ label: "Open Coaches", to: "/admin/coaches" }],
    sections: [
      { heading: "Adult roles", paragraphs: ["Every club has exactly one kind of master admin: the Owner. Owners keep full control — invitations with any role, role changes and removals, release approval, and news publishing. Admins keep their existing club powers (seasons, students, assignments, Team Practice, content, and the coach directory) but cannot invite coaches, manage invitations, or open PBE materials and PBE news at all — those areas are hidden in navigation and denied server-side. Content Managers are a narrower role: they can only open PBE materials and PBE news, where they draft and edit proposals and articles and run the NAD watcher. They cannot review releases, publish news, invite anyone, or reach any other coach page or admin API. The account menu shows each adult's role as a badge (for example, \"Content Manager mode\")."] },
      { heading: "Invite a coach", paragraphs: ["Only the Owner sees the invitation panel on the Coaches page. Enter the adult's email address and choose their role: Owner, Admin, or Content Manager. An invitation does not create access until the recipient completes the flow, and the role is stored on the invitation itself. Admins see the coach directory with a note that invitation management is Owner-only; the invite, resend, and revoke endpoints return 403 for non-Owners. (Behavior change: Admins previously could invite coaches as Admin; invitations are now Owner-only.)"] },
      { heading: "Sites without email delivery", paragraphs: ["On sites where email delivery is not configured, creating or resending an invitation returns a private invitation link right on the Coaches page instead of sending email. Copy it and share it with the recipient yourself; the link never appears in the invitation list. The recipient opens the link and creates their account directly — no verification code is involved — and lands with the role from the invitation. This direct path exists only where email is not configured; where email works, invitations always go through the email-verified flow."] },
      { heading: "Pending invitations", paragraphs: ["Pending invitations can be resent if the message was missed. Resending rotates the secret, so the previous link stops working. Revoke an invitation when it should stop working. Revoking a pending invitation does not remove an already accepted coach account."] },
      { heading: "Change roles and remove coaches", paragraphs: ["Only the Owner can change an adult's role or remove an adult from the club, using the controls in the coach directory. An Owner cannot change their own role, and the last active Owner cannot be demoted or removed — promote a successor first. Students never appear in the coach directory and cannot use coach invitations. Every coach-management action stays within the current organization."] },
    ],
    steps: ["Open Coaches and confirm the current directory.", "Use Invite a coach, enter the adult's email, and (as Owner) choose a role.", "On sites without email delivery, copy the invitation link and share it yourself.", "Resend when an invitation is still pending; revoke when it should be invalidated.", "Ask the new coach to complete the flow and sign in."],
    related: ["coach-onboarding", "account-privacy", "workspace-navigation", "coach-content"],
  },
  {
    id: "progress",
    title: "Progress and mastery evidence",
    audience: "Shared",
    scope: "public",
    summary: "Read stored attempts, mastery percentages, review counts, chapter progress, and coach summaries without confusing them with awards.",
    purpose: "Turn saved activity evidence into an honest view of coverage, mastery, and what to practice next.",
    prerequisites: ["Select the season whose evidence you want to understand.", "Interpret percentages only when the page shows an eligible assignment scope."],
    controls: [{ label: "Season selector", explanation: "Switches the summary to another saved season without changing assignments." }, { label: "Review detail", explanation: "Opens the underlying recap or student detail when summary evidence needs context." }],
    savedChanges: ["Attempts, review state, and historical progress are read from server records.", "Opening Progress is read-only; completing a new activity is what adds evidence."],
    permissions: ["Students see their own progress.", "Authorized coaches see club student summaries and individual evidence permitted by their role."],
    troubleshooting: ["An empty scope is not zero mastery; choose a season with eligible assignments.", "If a count looks stale after an activity, reload after the activity reports success."],
    featureIds: ["progress", "practice-progress"],
    keywords: ["progress", "mastery", "accuracy", "attempts", "review due", "chapter progress", "coverage", "coach progress"],
    glossary: ["mastery", "coverage", "review due", "historical evidence", "eligible scope"],
    links: [{ label: "Training HQ (your progress)", to: "/student" }, { label: "Coach overview", to: "/admin" }],
    sections: [
      { heading: "Student progress", paragraphs: ["Your progress lives on Training HQ, under your assigned passages. It summarizes recorded activity for the selected season and assignment scope. It can show attempts, mastered material, review due, and chapter-level coverage depending on the activity. The per-passage detail — chapter totals, skill breakdowns, and review due dates — lives in the passage picker on Training HQ: open Passage details under the verse tiles for the chapter you are viewing.", "On a PBE chapter's progress card, the counts read as tiles — Recalled, Retained, and Due or repair — beside the chapter's progress meter. In the passage browser, a verse's bar turns gold once the verse is Strong or Mastered, and a book's bar turns gold when every assigned verse in the book is Strong or Mastered. The counts read the same way — strong-or-mastered verses out of all the verses assigned in the book, not just the ones already practiced. Tapping a verse row starts a session on just that verse: Review when it is due, Practice otherwise.", "A percentage is shown only when the page has an eligible scope. An empty scope is not zero mastery; it is material that cannot yet produce a meaningful percentage."] },
      { heading: "Coach coverage", paragraphs: ["Coach overview and student progress show authorized summaries for learners in the club. Use the season selector to compare the current plan with stored historical activity; changing a selected season does not change assignments."] },
      { heading: "What progress does not mean", paragraphs: ["Progress is evidence from Erudoza training. It is not an official Pathfinder ranking, a competition placing, or a replacement for event results. Team Practice scores and individual Scripture mastery remain separate."] },
    ],
    steps: ["Choose the relevant season.", "Read the assignment scope before interpreting the percentage.", "Use review counts to decide what to practice next.", "Open a session recap or student detail when you need the evidence behind a summary."],
    faqs: [{ question: "Why did progress stay after an assignment changed?", answer: "Historical attempts and progress are preserved. The new assignment controls future eligibility while the old evidence remains part of the record." }],
    related: ["honors", "assignments", "review-and-recap"],
  },
  {
    id: "honors",
    title: "Achievement patches, milestones, and profile patches",
    audience: "Student",
    scope: "public",
    summary: "Understand mastery Achievement patches, historical practice milestones, eligibility requirements, and how unlocked patches become profile art.",
    featureIds: ["honors", "achievements"],
    keywords: ["Achievement patches", "Achievement patch", "Honors", "Honor", "mastery", "milestone", "patch", "earned", "locked", "requirement", "profile image", "team honor", "How to unlock", "spin", "back art", "Complete Mastery", "Proven Retention", "Full Coverage", "Steady Study", "training badge", "solo honor", "honor standard"],
    glossary: ["mastery Achievement patch", "practice milestone", "earned", "locked", "profile art", "back art"],
    links: [{ label: "Open Achievement patches", to: "/student/honors" }],
    screenshot: screenshot("/wiki/profile-character.png", "Sanitized profile character editor showing saved character art, appearance controls, and Achievement patch/profile tabs.", "Earned mastery Achievement patches can be selected as a profile image; historical milestones remain separate."),
    sections: [
      { heading: "Mastery Achievement patches", paragraphs: ["Mastery Achievement patches are earned from versioned Scripture-recall requirements. Each Achievement patch is shown as an art-first card: the patch artwork fills most of the card, with the title and earned/locked status below it. An earned patch carries a gold ring and its earned date; a locked patch is muted and shows its requirement — and, where the requirement counts progress, how far along you are.", "Tap the artwork (or press Enter on it) to open a detail dialog with the enlarged patch, its category, a How to unlock section explaining each requirement, earned/locked evidence, and the one action that fits — for example Use as profile image on an earned Achievement patch.", "On desktop, hovering the artwork plays a gentle lift-and-tilt. On touch screens, pressing the patch dips it toward your finger and it settles on release. The details dialog keeps keyboard focus and returns focus to the artwork when closed.", "Drag the artwork sideways — or swipe it on a touch screen, or press the arrow keys while it has focus — to spin the patch around and reveal the shared Laurel Honor back art. The patch has real thickness mid-spin and settles on the nearest face when you let go; a plain tap or click still opens the detail dialog."] },
      { heading: "Training badges and solo honors are different awards", paragraphs: ["Two award systems use similar language, so read the requirement, not just the title. Training badges come from practice activity — for example, the Full Coverage badge means every assigned source was seen, and the Steady Study badge means four qualifying practice weeks. Solo honors come from mastery evidence and are stricter: Complete Mastery (every passage in a scope of at least 30 brought to the honor standard) and Proven Retention (the honor standard kept on 20 passages, proven again by an unaided retest at least 48 hours later) are the solo counterparts, renamed so the two systems are not confused.", "The solo honor standard — exact wording 90, reference 80, recognition 80, with the retained retest for Proven Retention — is stricter than the Mastered passage level (exact wording 80, recognition 70, weakest practiced skill 60). A passage can read Mastered and still be short of an honor, and a solo honor's requirement always states the standard it uses."] },
      { heading: "Records: stamps and practice milestones", paragraphs: ["Below the Achievement patches, the Records section keeps your history together: PBE chapter stamps and earlier practice milestones, each with the date and the rules it was earned under. Records are history, not collectibles — they do not unlock mastery profile images.", "Team Practice answers do not automatically establish individual Solo accuracy. A requirement that calls for personal submissions must be met through that activity."] },
      { heading: "Using an Achievement patch", paragraphs: ["Select Use as profile image on an earned Achievement patch and it becomes your profile image right away — no trip to the profile page needed. You can still change it later in the profile editor. The same selected art appears in your profile and shared headshots where the account is authorized to be shown.", "An earned Achievement patch remains available for your profile even if later scores change. A locked Achievement patch cannot be selected until every listed requirement is met."] },
    ],
    steps: ["Open Achievement patches and choose a category or Earned/Locked filter.", "Open a requirement to see the actual target and current evidence.", "Complete the required individual or team activity.", "Choose Use as profile image after the Achievement patch is earned."],
    faqs: [{ question: "Are these official Pathfinder Honors?", answer: "No. Erudoza training patches are app achievements and practice milestones. They are not official Pathfinder Honors or competition rankings." }],
    related: ["profile-character", "progress", "team-practice"],
  },
  {
    id: "profile-character",
    title: "Profile, character, and sharing",
    audience: "Shared",
    scope: "app",
    summary: "Customize your character, choose earned Achievement patches, manage share-card privacy, and understand where your profile appears.",
    purpose: "Let each account choose profile identity art and explicitly control what is included in a share card.",
    prerequisites: ["Be signed in to the account whose profile you want to edit.", "Only earned Achievement patches and options allowed for the current role can be selected."],
    controls: [{ label: "Save profile", explanation: "Validates and stores the selected appearance, background, and earned art." }, { label: "Use as profile image", explanation: "Selects an earned Achievement patch as the account's profile art." }, { label: "2D / 3D", explanation: "Switches the character preview between the still render and the animated preview in place. The preview sits on a softly blurred copy of the selected background. The animation is a preview only and never changes the saved character. On the animated preview, moving the mouse or sliding a finger across the preview adds parallax depth between the background and the character; it eases back to rest and stays off when reduced motion is on. In fullscreen, tilting the phone itself can drive the same depth: tapping the preview asks iPhone for motion access the first time (other phones start automatically), and an \u201cEnable tilt\u201d button inside fullscreen retries if it was ever declined." }, { label: "Fullscreen preview", explanation: "Tap the character preview to open it large and fullscreen, with the 2D/3D toggle still available inside. Close with the X button, a tap outside the preview, or Escape." }, { label: "Character profile picture", explanation: "Choosing the character head as the profile picture animates it everywhere the avatar appears: it gently bobs, blinks, and glances side to side while staying in place. Achievement patches and initials stay still. The animation honors reduced-motion settings and never appears in downloads or share cards." }, { label: "Share", explanation: "Opens a preview where visible fields and the downloadable card can be checked." }],
    savedChanges: ["Profile appearance and selected Achievement patch choices are saved to the account.", "Downloading a share card does not make a private profile public by itself."],
    permissions: ["An account can edit its own profile.", "Roster headshots show only the profile art the current viewer is authorized to see."],
    troubleshooting: ["A locked Achievement patch cannot be selected until its requirements are recorded as earned.", "If a profile save fails, keep the page open and use the displayed retry or recovery action."],
    featureIds: ["profile"],
    keywords: ["profile", "character", "avatar", "animated avatar", "portrait", "appearance", "share", "username", "QR", "privacy", "Honor", "coach guide", "animated", "3D"],
    glossary: ["profile art", "share card", "private profile", "headshot", "Achievement patch selector"],
    links: [{ label: "Student profile", to: "/student/profile" }, { label: "Coach profile", to: "/admin/profile" }],
    screenshot: screenshot("/wiki/profile-character.png", "Sanitized profile character editor showing the current character, appearance choices, background, and coach-only attire boundary.", "Profile choices are saved to the account and shared headshots use the current selection."),
    sections: [
      { heading: "Build your character", paragraphs: ["The profile page opens with one combined header card: your name, your level, an XP bar captioned with the next level, your streak, and — in the same card — your sash row with your character, how many sash spots are filled, and the Edit and Share actions. The card carries no separate profile picture; your profile picture itself is chosen in the Profile image section. On a phone, scrolling folds the header into a slim strip at the top of the screen with your character, your name and level, and the Edit and Share buttons, so your character stays in view while you work further down the page. Below the header, the profile editor combines the account identity with an appearance, background, and earned sash/Achievement patch choices. Preview changes before saving. The server checks that the selected options are available to the account.", "Use the 2D/3D toggle above the character to watch an animated preview — head movement, blinking, and sash sway bring the current choices to life without changing anything saved. Students can use their saved profile in Student mode. Eligible adult accounts can use the same character system in Coach mode; the Coach-only Master Guide option is not shown to students."] },
      { heading: "Unlockable cosmetics", paragraphs: ["Some character options are locked until you earn them: the Starlight Camp background unlocks with a 7-day practice streak, the second set of hairstyles unlocks at level 4 (Keeper), and sash spots 2 and 3 unlock with a Team Practice Achievement patch and a Simulation Achievement patch. Hair colors are never locked — only styles are.", "Locked options show what earns them. They stay visible but cannot be chosen, and the server rejects any save that tries to include them. A character saved before an option existed keeps displaying, but you must remove the locked choice before saving again."] },
      { heading: "Choose Achievement patches", paragraphs: ["Only earned, eligible Achievement patches can be selected for the profile. Locked art stays visible as a requirement preview but cannot be saved as an earned choice. Saving one choice does not overwrite unrelated draft edits when another choice becomes unavailable.", "The Achievement patch collection uses art-first cards: the patch fills the card and tapping the artwork opens a detail dialog with the enlarged art, category, a How to unlock section, and the Use as profile image action on earned Achievement patches."] },
      { heading: "Share card privacy", paragraphs: ["The share editor controls which account details appear on the share card, such as username, Erudoza mark, and QR decoration. Use the preview and download action to check the result before sharing it.", "Sharing is an explicit action. A private profile remains private until you choose to share or download its card."] },
      { heading: "Shared headshots", paragraphs: ["Roster and directory headshots resolve the current profile by user ID and fall back to initials when no profile art is available. This keeps messages and lists tied to the current account state rather than copying stale image data.", "When the character head is the selected profile picture, the headshot animates in place — a gentle bob, blinking, and a sideways glance — everywhere the avatar appears, including the app header. Achievement patches and initials stay still. Downloads and share cards always use the still portrait."] },
    ],
    steps: ["Open Your profile from Account or the workspace navigation.", "Choose appearance and earned profile art options.", "Use the 2D/3D toggle to preview the animated version of the character, or tap the preview to see it fullscreen.", "Save and wait for the success or recovery message.", "Open Share to choose visible details and download a card when desired."],
    faqs: [{ question: "Can I choose a locked Achievement patch?", answer: "No. Locked Achievement patches explain their requirements but cannot be used as profile art until the server records them as earned." }, { question: "Why can't I pick a hairstyle or background?", answer: "Some character options unlock through study: a 7-day streak, level 4, or Team Practice and Simulation Achievement patches. Hair colors are never locked — only styles are. The locked option shows what earns it. Use Remove unavailable choices to swap locked picks for free defaults." }],
    related: ["honors", "account-privacy", "workspace-navigation"],
  },
  {
    id: "team-practice",
    title: "Team Practice",
    audience: "Shared",
    scope: "public",
    summary: "Coaches set up team practice events and assign the teams; students join their assigned rehearsal or head-to-head room, play together, and review results.",
    purpose: "Coordinate live group rehearsal while keeping room state, scoring rules, and individual mastery evidence distinct.",
    prerequisites: ["Team Practice must be enabled for the club and the season must have eligible material.", "Students need an authorized club account and a coach assignment to an event. Coaches create and manage the events."],
    controls: [{ label: "Create event", explanation: "Coach-only: sets up a rehearsal or head-to-head event, assigns every seat from the season roster, and opens it now or schedules it." }, { label: "Mark ready", explanation: "Tells the authoritative room state that the player can begin." }, { label: "Answer / submit", explanation: "Records the team's response for the current question and phase." }],
    savedChanges: ["Event assignments, room membership, readiness, question responses, scores, and review state are saved as the match advances.", "Completed team results remain separate from individual Solo mastery evidence."],
    permissions: ["Coaches create, edit, cancel, and duplicate events, moderate rooms, and review PBE answers.", "Students see only the events they are assigned to and their own team results."],
    troubleshooting: ["Reconnect to the same room after a disconnect; do not ask for a replacement while the original is recovering.", "If PBE is disabled, ask a coach to check the season setting and published question bank."],
    featureIds: ["practice", "events", "create-event", "rooms", "invitations", "questions", "achievements", "practice-progress"],
    keywords: ["Team Practice", "team", "event", "assigned", "schedule", "room", "lobby", "invite", "PVP", "Arcade", "PBE", "score", "question bank", "review", "practice together", "room recap", "full-event team rehearsal", "Simulation Achievement patches"],
    glossary: ["room", "lobby", "Arcade", "PBE", "provisional result", "team evidence"],
    links: [{ label: "Student Team Practice", to: "/student/practice" }, { label: "Coach Team Practice", to: "/admin/practice" }],
    screenshot: screenshot("/wiki/team-practice.png", "Sanitized Team Practice hub showing PBE reviews, the active season, coach events, team achievement patches, and the coach question bank.", "Team Practice brings a group together around the selected season's assigned Scripture."),
    sections: [
      { heading: "Enable and choose a mode", paragraphs: ["Season settings offer two separate switches: Team Practice for your club and PBE training for this season. The club switch enables Team Practice events, simulations, and answer reviews; students see the hub once it is on and an active season is available. While the club switch is off, the hub stays reachable and explains that Team Practice is off, and the Team Practice section shortcuts (Your events, Create event, Your rooms, Invitations) stay out of the navigation instead of landing on a hub that cannot use them. PBE simulation and PBE rehearsal events stay locked until PBE training is turned on for that season — a coach can flip it on in season settings or from the Turn on PBE training button in the event form. Use the hub to practice together around the same assigned Scripture scope.", "Arcade is head-to-head practice scored for accuracy with a possible speed bonus. PBE is rubric-based rehearsal; it uses accuracy points and does not add the Arcade speed bonus. One-team PBE rehearsal is called Simulation and is configured by the coach inside the event form."] },
      { heading: "How events work", paragraphs: ["Team Practice is coach-led. A coach creates an event: the activity (full-event team rehearsal or head-to-head practice), the season, the match settings, and the roster. Every seat must be filled from the season roster before the event can be saved. The coach opens the event right away or schedules it for a later start time.", "Assigned students get a bell notification and find the event on their Team Practice page under Happening now or Coming up. When the event opens, its room is created with the teams already in place — nobody picks a side or waits for invitations. If someone drops out before the start, the coach can invite a substitute into the open seat from the room. Rooms lock when the match starts, so late joins are not possible.", "The coach starts the match. In the event form the coach can also name a student captain who is allowed to start that one event. Coaches can watch each open event live (who is in the room and who is ready), edit or cancel a scheduled event, and reuse a finished setup with Use as template. Roster changes and cancellations notify the affected students."] },
      { heading: "Lobby and live match", paragraphs: ["Players open their assigned room from Team Practice and mark ready. The coach starts when the roster and readiness are correct; a designated captain can start that one event too, but only once every seat is filled and every player is ready — the room enforces the full-roster rule for captains and coaches alike. The live question, response timer, discussion, and scoreboard follow the authoritative room phase.", "If the browser loses connection, reconnect and return to the room. Do not ask for a second room while the original is recovering; the room keeps its revision and current question when possible."] },
      { heading: "Results and honors", paragraphs: ["Completed rooms show team score breakdowns and answer review state. Coaches can review PBE answers and resolve appeals from the answer-review queue. Team milestones preserve their original criteria and remain distinct from individual mastery Achievement patches.", "When a room completes, each student gets a room recap page showing their team number and team score, their personal questions answered, XP earned, completed bonus quests with their +25 XP rewards, practice-day credit, and season milestones. The recap's Review answers action reopens the room, where each recorded answer and its result can be read. Rooms played before room XP tracking say so honestly instead of showing XP. A full-event team rehearsal also counts toward Simulation Achievement patches; solo timed rehearsals from Study earn XP and streak credit instead.", "Team Practice participation is useful rehearsal, not an official event placing. Review the saved results with your coach before treating a score as final."] },

    ],
    steps: ["Coaches: open Team Practice and choose Create event.", "Pick the activity and season, fill every seat from the roster, and open the event now or schedule it.", "Students: open Team Practice and join your assigned room from Happening now.", "Mark ready; the coach (or designated captain) starts the match.", "Answer together during the live question phase.", "Review results and any coach decisions after the room completes."],
    faqs: [
      { question: "Why can I see the hub but not start PBE?", answer: "PBE needs the season's PBE training switch turned on, plus an eligible question bank. The club-level Team Practice toggle alone does not unlock it. Ask a coach to turn on PBE training in season settings, or use the Turn on PBE training button in the event form." },
      { question: "Can I create my own practice room?", answer: "No. Team Practice is coach-led: your coach sets up each event and assigns the teams, so everyone arrives to a ready room. If you want a practice, ask your coach to schedule one." },
      { question: "How do I know when a practice is assigned to me?", answer: "Your coach's event appears on your Team Practice page, and the notification bell tells you when you are assigned, moved, rescheduled, or cancelled." },
      { question: "Does a team score change my individual mastery?", answer: "No. Team Practice results, team milestones, and individual Scripture mastery use separate evidence rules." },
    ],
    related: ["simulation", "pbe-reviews", "honors", "workspace-navigation"],
  },
  {
    id: "pbe-reviews",
    title: "PBE question bank and answer reviews",
    audience: "Coach",
    scope: "app",
    summary: "Prepare source-backed PBE questions, publish reviewed versions, and resolve saved answer reviews without hiding provisional results.",
    featureIds: ["questions"],
    keywords: ["PBE", "question bank", "question", "source", "publish", "answer review", "appeal", "rubric", "coach review"],
    links: [{ label: "Open answer reviews", to: "/admin/practice/reviews" }, { label: "Open Team Practice", to: "/admin/practice" }],
    sections: [
      { heading: "Prepare a question", paragraphs: ["Question preparation declares the source Scripture units and accepted answers. Keep the source reference and canonical evidence aligned so a student or coach can understand why an answer receives credit.", "Review a question before publishing. Published versions are the material rooms use; changing a later version should not rewrite the history of a completed room."] },
      { heading: "Review saved answers", paragraphs: ["The answer-review queue contains saved PBE responses that need a coach decision. Review the prompt, source evidence, submitted answer, and rubric context before resolving an appeal.", "While an answer remains unresolved, the result is provisional. The team can see that a review is needed, and the coach can resolve it without holding up unrelated individual practice.", "When a ruling changes a Solo answer's points, the student's XP is re-priced with them: the difference is added to or removed from the student's XP totals, and the recap shows the corrected points as the coach's correction. The correction does not reopen the daily attempt-XP cap the original attempt consumed."] },
      { heading: "Permissions", paragraphs: ["Question authoring and answer review are coach workflows. Students can participate in a room and see their own results, but they cannot publish questions or judge another team's answer."] },
    ],
    steps: ["Open Team Practice as a coach.", "Prepare or review the source-backed question and its accepted answer.", "Publish the reviewed version when it is ready for rooms.", "Open PBE answer reviews, inspect evidence, then record the decision."],
    related: ["team-practice", "seasons", "progress"],
  },
  {
    id: "coach-overview",
    title: "Coach overview and student coverage",
    audience: "Coach",
    scope: "app",
    summary: "Use the overview to select a season, see who needs attention, review assignment coverage, and open your own training.",
    featureIds: ["overview"],
    keywords: ["coach overview", "season overview", "coverage", "need review", "needs attention", "assigned students", "mastery", "dashboard", "team practice", "your training"],
    links: [{ label: "Open Coach overview", to: "/admin" }],
    sections: [
      { heading: "Read the overview", paragraphs: ["Coach overview summarizes the selected season and the students in your club. Counts distinguish students with assignments from students who need review and show the assignment/progress table below.", "The Needs attention panel names students with passages due for review, students who have not practiced this week, and students who have not started their assigned passage, with a weekly team pulse underneath. The page intentionally shows an empty state when there is no season rather than inventing coverage."] },
      { heading: "Take action", paragraphs: ["Open a student's progress for evidence, Student directory for account management, or the assignment editor to change future study scope. The Need review count opens the student directory filtered to that season's students who need review, and the Needs attention items deep-link the same way: passages due for review and students who haven't started open their filtered directory views, while students who haven't practiced open the Engagement tab with the season already chosen. The Assignments count opens the season assignment editor, and Plan team practice opens Team Practice. Your training opens Training HQ in student mode so you can keep your own streak. The overview is a starting point, not a replacement for the detailed editors."] },
    ],
    steps: ["Open Coach overview.", "Select the season you want to inspect.", "Read assigned-student, review, and assignment status.", "Open the relevant detail page for the next coaching action."],
    related: ["seasons", "student-directory", "progress"],
  },
  {
    id: "control-center",
    title: "Control Center (master admin)",
    audience: "Coach",
    scope: "app",
    summary: "The app-wide operations page for the master admin account: whole-app analytics, club health, support tickets, and system state across every club.",
    featureIds: ["control-center"],
    keywords: ["control center", "master admin", "analytics", "all clubs", "support tickets", "club health", "onboarding funnel", "weekly digest", "server errors", "system", "needs attention"],
    links: [{ label: "Open Control Center", to: "/admin/control-center" }],
    sections: [
      { heading: "Who can open it", paragraphs: ["The Control Center is not a club page. It opens only for the one master admin account for the whole app; every other account — Owners, Admins, Content Managers, and students — sees a restricted notice, and the server denies its data endpoints to them. There is no per-club version: every number on the page covers all clubs and all users."] },
      { heading: "The five tabs", paragraphs: ["The Control Center has its own shell: a sidebar on wide screens and a bottom navigation bar on phones, separate from the club workspace pages. Overview shows total users, users active this week, practice sessions today, and XP awarded this week, with a practice-activity chart that switches between the last 7 and 14 days, today's sessions broken down by club, the latest weekly digest, and a Needs attention panel that links straight to whatever needs work — aging tickets, material drafts awaiting review, open answer disputes, and recent server errors. Users & clubs lists a club health table (learners, active learners this week, sessions this week, and learners quiet for 7+ days), the newest accounts across clubs, and the onboarding funnel from invitations sent to accounts created to first practice to active this week — each funnel step names the records it is counted from. Content summarizes the shared library: the NAD watcher's last run, material drafts awaiting review, live releases, news counts, and the Scripture library size, plus seasons across clubs and open answer disputes. System shows service health, the live version, the weekly run schedule, which service secrets are present (names only, never values), server error counts for the last 24 hours and 7 days grouped by area of the app, and shortcuts into the club admin pages."] },
      { heading: "Support & tickets", paragraphs: ["The Support & tickets tab is where user support requests are worked, queue first and the recent inbox below it. The app footer carries a Contact support link that opens an email to the support address; messages that arrive there appear in the tab's inbox. Make ticket on an inbox email opens a dialog with the ticket fields filled in from that email; New ticket opens the same dialog blank for requests that arrived another way. Converting the same email twice never creates a duplicate — the dialog reports the ticket that already exists. Each ticket has a requester, a subject, and a status — New, Open, Waiting, or Resolved — changed from the status control on the ticket; if a status change fails to save, the ticket keeps its last confirmed status and offers a retry. Header counts show new emails, open tickets, and aging: an open ticket older than 48 hours is flagged amber, and older than 7 days red, counted from when the ticket was opened. A How support works section at the bottom of the tab explains the flow end to end."] },
      { heading: "Weekly digest", paragraphs: ["Every Monday at 10:00 UTC the weekly run composes a digest for the week just ended — new users, active clubs and users, sessions, XP awarded, open tickets, and server errors — stores it on the Overview tab, and emails it to the master admin when email is configured."] },
      { heading: "Reading the numbers honestly", paragraphs: ["Join dates come from each account's recorded creation time; accounts created before that recording began show “Join date unavailable” rather than a guessed date. Practice-session history is kept in a daily rollup, so the 14-day chart survives long-term. Server errors are recorded by the worker when a request fails with a server error; the counts cover the last 30 days of records."] },
    ],
    steps: ["Open Control Center from the coach navigation (master admin account only).", "Pick a tab: Overview, Users & clubs, Content, Support & tickets, or System.", "In Support & tickets, turn inbox emails into tickets and update each ticket's status as it is worked.", "Use System to confirm the live version and check error counts after any incident."],
    related: ["coach-overview", "coaches", "account-privacy"],
  },
  {
    id: "coach-content",
    title: "Coach Scripture content and reading",
    audience: "Coach",
    scope: "app",
    summary: "Review the installed Scripture catalog and read source chapters without changing the season or student plans.",
    featureIds: ["library", "books", "preview", "materials", "news"],
    keywords: ["coach content", "library", "Scripture", "catalog", "read", "chapter", "source", "NKJV", "PBE materials", "PBE news", "release", "proposal", "approve", "publish", "NAD watcher"],
    links: [{ label: "Open coach Scripture library", to: "/admin/content" }, { label: "Open PBE materials", to: "/admin/materials" }, { label: "Open PBE news", to: "/admin/news" }],
    sections: [
      { heading: "Content is a source of truth", paragraphs: ["The coach library displays installed source content and metadata used by season and assignment selectors. Use it to verify a book, chapter, or passage before building a plan.", "The reader is not an assignment editor. Choosing or reading a chapter here does not assign it to a student."] },
      { heading: "Use with season setup", paragraphs: ["Start with the installed catalog when choosing whole books for a season. The assignment editor then narrows those books to chapters per student while preserving the catalog's actual coordinates."] },
      { heading: "PBE materials dashboard", paragraphs: ["The PBE materials page manages the yearly competition releases students see in their library. The Releases tab lists every proposal with its status (Draft, Approved, Rejected), origin (Watcher or Manual), and proposed date.", "Check for new NAD materials asks the NAD watcher to scan nadpbe.org for new PDFs; anything it finds becomes a draft proposal, never a published release. New proposal drafts a year manually: competition year, source URLs, the book roster (chapters as 1-33 or 1,2,3), and the commentary introduction sections.", "Opening a proposal shows the full draft, the original source links, and the differences against the current live release for that year. Drafts stay editable so a coach can complete a watcher-drafted proposal.", "Approval is Owner-only: only the club Owner (master admin) can approve or reject, and never their own proposal — a different approver must review it. Approving publishes the release to students; rejecting closes the proposal with the review note.", "Owners and Content Managers can draft and edit proposals and run the watcher. Regular Admins cannot open PBE materials at all — the destination is hidden and the endpoints return 403."] },
      { heading: "PBE news management", paragraphs: ["The News tab on the PBE materials page is a three-column newsroom: Sources, Article editor, and Pipeline. Articles start as drafts; students only ever see published articles. The NAD watcher may also suggest news articles when it detects new material — each suggestion still needs review before publishing. Suggestions never pile up: a watcher suggestion that is still unpublished after 30 days deletes itself, at most the 25 newest suggestions are kept, and dismissing or expiring a suggestion retires its source, so the watcher never suggests the same announcement twice. A coach's own drafts are never deleted automatically, and published articles are never touched.", "Sources pulls the latest developments: run \"Check for new NAD materials\" to collect watcher suggestions, or paste any announcement link into Import from URL to extract a draft (title, summary, and body text) you can edit before saving. The editor takes an article type (Competition, Study material, Rule update, Announcement — each gets its own thin art header on the student card), a title, a short summary for the feed card, up to six \"In this article\" key points shown as chips on the card, repeatable heading-and-body sections, an estimated read time, and linked reading material with deep links (library chapters or document URLs) that students open straight from the card and the article. An optional source URL with label links the original announcement. As you edit, a Student preview in the editor shows the exact card students will see on the feed, updating as you type.", "Drafts and published articles stay editable by Owners and Content Managers; regular Admins cannot open PBE news at all. Publishing, unpublishing, and deleting are Owner-only — deletion asks for confirmation and cannot be undone. Watcher suggestions carry one extra action any Owner or Content Manager can use: Dismiss, which removes the suggestion for good in one tap. News deliberately has no proposer-versus-approver separation: news is time-sensitive, the Owner is often the author with no second reviewer available, it never changes the study corpus, and a published article can be unpublished immediately. Publishing a watcher-suggested draft is the review step: check the student preview, fix anything, then publish."] },
    ],
    steps: ["Open Scripture library from the Coach navigation.", "Search the catalog or select a book.", "Open a chapter and verify the source reference.", "Return to Seasons or Assignments when you are ready to configure scope.", "Open PBE materials to review yearly releases or manage the news feed."],
    related: ["scripture-library", "seasons", "assignments"],
  },
  {
    id: "account-privacy",
    title: "Privacy, permissions, and saved data",
    audience: "Shared",
    scope: "public",
    summary: "Understand who can see or change club data, how profiles are shared, and what happens when a request fails.",
    featureIds: ["permissions"],
    keywords: ["privacy", "permissions", "organization", "club", "access", "saved data", "server", "profile privacy", "security"],
    sections: [
      { heading: "Club boundaries", paragraphs: ["Season, student, coach, assignment, and practice data is scoped to the current club. Changing an ID in a URL does not grant access to another organization; the server checks the signed-in account and organization on every protected route."] },
      { heading: "Student and coach visibility", paragraphs: ["Students see their own training and profile data plus the team practice rooms they are authorized to join. Coaches see authorized club rosters, plans, coverage, and practice moderation. A student cannot use a coach route to manage another account."] },
      { heading: "Saved versus draft", paragraphs: ["A success message means the server accepted the change. Draft controls preserve unsaved choices until you confirm a save or intentionally discard them. When a request fails, use the page's retry and recovery guidance rather than assuming the draft was stored."] },
      { heading: "Share intentionally", paragraphs: ["A profile share card is separate from the private account profile. Check its preview and visible fields before downloading or sending it."] },
    ],
    faqs: [{ question: "Can I open a route from another role?", answer: "The application may show common documentation links, but the destination still applies its normal authentication and role checks." }],
    related: ["account-access", "profile-character", "troubleshooting"],
  },
  {
    id: "accessibility-and-install",
    title: "Accessibility, mobile use, and installing Erudoza",
    audience: "Shared",
    scope: "public",
    summary: "Use keyboard navigation, touch-friendly controls, reduced motion, and the optional installed web app.",
    featureIds: ["install", "support"],
    keywords: ["accessibility", "keyboard", "focus", "screen reader", "mobile", "phone", "install", "download app", "PWA", "reduced motion"],
    sections: [
      { heading: "Keyboard and focus", paragraphs: ["Use Tab to move through controls, Enter or Space to activate buttons, and Escape to close dialogs or menus. Search supports Ctrl/Command K and arrow-key navigation. Skip links move directly to the page content.", "Dialogs return focus to the control that opened them. If focus seems lost, press Tab once and look for the visible focus ring."] },
      { heading: "Dark theme", paragraphs: ["Erudoza follows your phone or computer automatically: when your device is in dark mode, the app uses its dark theme with warm charcoal surfaces.", "Tap the theme switch next to the notification bell in the top bar — sun on the left, moon on the right — to pin light or dark. Until you flip it, Automatic keeps following your device.", "On phones the theme switch lives inside the account menu. Your choice is remembered on that device."] },
      { heading: "Phones and small screens", paragraphs: ["The workspace keeps primary destinations in the mobile dock and stacks forms into one column. Lists with dense data may scroll inside their labeled region; the page should not require sideways scrolling.", "Use the browser zoom and text-size settings when needed. Controls retain touch-sized targets and feedback stays close to the action."] },
      { heading: "Install the web app", paragraphs: ["Download app opens browser-specific guidance. On iPhone or iPad, use Safari's Share menu and Add to Home Screen. On Android or desktop, use the browser's Install app or Add to Home screen option when offered.", "Installation is optional. Erudoza still works as a browser site and requires an internet connection for live account and training data."] },
    ],
    steps: ["Open Download app from the footer when your browser supports installation.", "Follow the device-specific Add to Home Screen or Install prompt.", "Open Erudoza from the new icon and sign in.", "Use the browser version if installation is unavailable."],
    related: ["workspace-navigation", "account-access", "troubleshooting"],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting and recovery",
    audience: "Shared",
    scope: "app",
    summary: "Recover from loading errors, interrupted saves, stale pages, missing assignments, and live-room connection problems.",
    featureIds: ["troubleshooting"],
    keywords: ["troubleshooting", "error", "retry", "offline", "loading", "timeout", "connection", "stale", "refresh", "recovery"],
    sections: [
      { heading: "A page will not load", paragraphs: ["Check your connection, wait for the status message, then choose the page's Retry or Try again action. If the account session expired, sign in again. Avoid opening many duplicate tabs while a request is pending."] },
      { heading: "A save is still pending", paragraphs: ["Keep the page open until confirmed progress or an explicit failure appears. Assignment saves reconcile confirmed chapters and provide Retry for the remainder. Season activation and destructive lifecycle actions use a confirmation step."] },
      { heading: "The page looks stale", paragraphs: ["Use the page's refresh control or navigate back to the relevant section. Saved server state is authoritative; a successful save should survive a normal reload. If the selected season is wrong, choose it again from the page selector."] },
      { heading: "A live room disconnects", paragraphs: ["Reconnect to the same room and wait for its live state to return. The authoritative room keeps the phase, revision, and question when recovery succeeds. If the room cannot recover, ask your coach to set up a new event — students cannot create replacement rooms."] },
      { heading: "When to contact a coach", paragraphs: ["Ask a coach about missing assignments, disabled PBE settings, student credentials, unavailable seasons, or a club invitation. Include the page name and visible error wording, but never send a password or security code."] },
    ],
    steps: ["Read the visible error and identify whether it is access, data, connection, or save related.", "Use Retry once the page is ready.", "Confirm the resulting saved state or sign-in state.", "Contact a coach with the page and error text if the issue continues."],
    faqs: [{ question: "Should I refresh during a save?", answer: "No. Wait for confirmed progress or failure first. Refreshing during a write can make the browser state harder to interpret." }],
    related: ["assignments", "account-access", "team-practice"],
  },
  {
    id: "pbe-rules",
    title: "PBE, Arcade, and team scoring",
    audience: "Shared",
    scope: "public",
    summary: "Understand the difference between individual practice, Arcade speed scoring, and rubric-based PBE rehearsal.",
    featureIds: ["practice"],
    keywords: ["PBE", "Arcade", "scoring", "speed bonus", "accuracy", "rubric", "official placing", "team score"],
    glossary: ["PBE rubric", "Arcade speed bonus", "official placing", "provisional result"],
    sections: [
      { heading: "Individual practice", paragraphs: ["Student Study activities measure recall against assigned Scripture and update individual evidence. They are separate from Team Practice rooms and their team scores."] },
      { heading: "Arcade", paragraphs: ["Arcade head-to-head practice scores accuracy and can add up to a 25% speed bonus based on server-observed elapsed time. Incorrect answers do not earn a speed bonus."] },
      { heading: "PBE rehearsal", paragraphs: ["PBE uses rubric accuracy points. Simulation is a one-team rehearsal; head-to-head PBE has two active teams. PBE practice results remain provisional until required review is complete and do not declare an official event placing.", "For solo PBE practice, XP follows the points: a fully correct answer earns the full attempt XP, a partial answer — some but not all of its points — earns half of that, and a scoreless answer earns the incorrect-answer amount."] },
    ],
    faqs: [{ question: "Why did a quick answer not increase a PBE score?", answer: "PBE rubric scoring does not use the Arcade speed bonus. Speed is relevant to Arcade practice only." }],
    related: ["team-practice", "simulation", "progress"],
  },
  {
    id: "content-and-scope",
    title: "How Scripture scope and eligibility work",
    audience: "Shared",
    scope: "public",
    summary: "Follow the path from installed source catalog to season books, student chapters, eligible activities, and stored evidence.",
    featureIds: ["library", "season-books"],
    keywords: ["scope", "eligibility", "catalog", "season books", "assigned chapters", "source units", "activity", "reading"],
    sections: [
      { heading: "The scope chain", paragraphs: ["Erudoza uses a clear scope chain: installed Scripture catalog → season whole books → student chapter assignments → activity eligibility → stored attempt or team evidence. Each step narrows what the next workflow can use."] },
      { heading: "What does not broaden scope", paragraphs: ["Reading a general library chapter, opening a share card, or viewing an Achievement patch requirement does not broaden assignments. An adult changing a season or a student plan is the action that changes future eligible material, subject to the route's permissions."] },
      { heading: "Why the UI repeats references", paragraphs: ["Book, chapter, season, and assignment labels are repeated on training cards so the learner can verify the exact source before answering. If a label is unavailable, the page should show an honest empty or unavailable state rather than a guessed reference."] },
    ],
    related: ["scripture-library", "seasons", "assignments", "study-and-practice"],
  },
  {
    id: "wiki-search",
    title: "Search the wiki and find an explanation",
    audience: "Shared",
    scope: "public",
    summary: "Search any guide by feature name, PBE term, Achievement patch requirement, or scoring question.",
    featureIds: ["wiki"],
    keywords: ["wiki", "help", "search", "explanation", "guide", "article", "FAQ", "keyword"],
    links: [{ label: "Open the wiki", to: "/wiki" }],
    sections: [
      { heading: "Search is intentionally broad", paragraphs: ["The wiki search indexes article titles, summaries, section headings, FAQ answers, and keywords. Search for what you want to understand—such as PBE, Achievement patches, scoring, or creating a club—rather than only the page title."] },
      { heading: "Use role filters", paragraphs: ["All shows every explanation. Student, Coach, and Shared narrow the list without hiding content from the other role. Role labels identify who each guide is written for."] },
      { heading: "Share a useful result", paragraphs: ["Search terms are stored in the URL, so you can copy a link such as `/wiki?q=PBE` to return to the same explanation. Article headings have stable anchors for direct links."] },
    ],
    steps: ["Open the wiki from the site footer.", "Enter a feature, PBE term, or question in Search the wiki.", "Choose a role filter if the result list is too broad.", "Open the matching guide to learn how Erudoza works."],
    related: ["account-access", "coach-onboarding", "pbe-rules"],
  },
  {
    id: "help-search",
    title: "Search help and find an explanation",
    audience: "Shared",
    scope: "app",
    summary: "Search any help guide by feature name, control label, status, requirement, or troubleshooting phrase.",
    featureIds: ["wiki"],
    keywords: ["help", "search", "explanation", "guide", "article", "FAQ", "keyword"],
    links: [{ label: "Open help", to: "/help" }],
    sections: [
      { heading: "Search is intentionally broad", paragraphs: ["Help search indexes article titles, summaries, section headings, step instructions, FAQ answers, control labels, route names, and keywords. Search for what you see on screen—such as Save assignments, Review, PBE, or retry—rather than only the page title."] },
      { heading: "Use role filters", paragraphs: ["All shows every explanation. Student, Coach, and Shared narrow the list without hiding content from the other role. Role labels identify who can use the linked workflow; existing application permissions still decide whether a route opens."] },
      { heading: "Share a useful result", paragraphs: ["Search terms are stored in the URL, so you can copy a link such as `/help?q=assignment` to return to the same explanation. Article headings have stable anchors for direct links from release notes and coach instructions."] },
    ],
    steps: ["Open Help from Search, Account, or the workspace navigation.", "Enter a feature, control, status, or question in Search help.", "Choose a role filter if the result list is too broad.", "Open the matching guide, then use Open feature to return to the product workflow."],
    related: ["workspace-navigation", "troubleshooting", "account-access"],
  },
];

export const publicWikiGroups: WikiGroup[] = [
  { id: "start", title: "Start here", description: "Accounts, creating a club, and finding answers.", articleIds: ["account-access", "coach-onboarding", "wiki-search", "accessibility-and-install"] },
  { id: "features", title: "Features", description: "What students and coaches can do with Erudoza.", articleIds: ["scripture-library", "team-practice", "simulation", "honors", "progress"] },
  { id: "reference", title: "Rules and reference", description: "Scoring, Scripture scope, and privacy.", articleIds: ["pbe-rules", "content-and-scope", "account-privacy"] },
];

export const appWikiGroups: WikiGroup[] = [
  { id: "start", title: "Start here", description: "Navigation, search, and getting unstuck.", articleIds: ["workspace-navigation", "help-search", "troubleshooting"] },
  { id: "student", title: "Student guides", description: "Study Scripture, build evidence, and manage your profile.", articleIds: ["student-training-hq", "study-and-practice", "review-and-recap", "assignments", "profile-character"] },
  { id: "coach", title: "Coach guides", description: "Build seasons, support students, and run the club workspace.", articleIds: ["coach-overview", "seasons", "student-directory", "coaches", "coach-content", "pbe-reviews", "control-center"] },
];

export function wikiGroups(scope: WikiScope): WikiGroup[] {
  return scope === "public" ? publicWikiGroups : appWikiGroups;
}

export function wikiArticlesByScope(scope: WikiScope): WikiArticle[] {
  return wikiArticles.filter(article => article.scope === scope);
}

const searchableText = (article: WikiArticle) => [
  article.title,
  article.summary,
  article.purpose,
  ...(article.prerequisites ?? []),
  ...(article.controls ?? []).flatMap(control => [control.label, control.explanation]),
  ...(article.savedChanges ?? []),
  ...(article.permissions ?? []),
  ...(article.troubleshooting ?? []),
  ...(article.glossary ?? []),
  article.audience,
  ...article.keywords,
  ...article.sections.flatMap(section => [section.heading, ...section.paragraphs, ...(section.bullets ?? [])]),
  ...(article.steps ?? []),
  ...(article.faqs ?? []).flatMap(faq => [faq.question, faq.answer]),
].join(" ").toLocaleLowerCase();

const words = (value: string) => value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);

export function searchWiki(articles: WikiArticle[], query: string): WikiSearchResult[] {
  const queryWords = words(query);
  return articles.map((article, index) => {
    if (!queryWords.length) return { article, score: -index };
    const title = article.title.toLocaleLowerCase();
    const summary = article.summary.toLocaleLowerCase();
    const keywords = article.keywords.join(" ").toLocaleLowerCase();
    const searchable = searchableText(article);
    let score = 0;
    for (const word of queryWords) {
      if (!searchable.includes(word)) return null;
      if (title.includes(word)) score += 8;
      if (summary.includes(word)) score += 4;
      if (keywords.includes(word)) score += 3;
      if (!title.includes(word) && !summary.includes(word) && !keywords.includes(word)) score += 1;
    }
    return { article, score: score - index / 1000 };
  }).filter((result): result is WikiSearchResult => result !== null).sort((left, right) => right.score - left.score);
}

export function wikiArticle(id: string) {
  return wikiArticles.find(article => article.id === id);
}
