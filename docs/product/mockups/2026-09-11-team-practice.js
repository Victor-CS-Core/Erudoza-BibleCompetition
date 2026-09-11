(() => {
  'use strict';
  const paths = {
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    chevron: 'm7 10 5 5 5-5', close: 'm6 6 12 12M6 18 18 6',
    home: 'm3 10 9-7 9 7v10h-6v-6H9v6H3Z',
    book: 'M12 5C9 3 5 3 2 4v15c4-1 7-1 10 1m0-15c3-2 7-2 10-1v15c-4-1-7-1-10 1V5Z',
    flag: 'M4 22V3m0 1c5-4 10 4 16 0v10c-6 4-11-4-16 0',
    grid: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',
    team: 'M5 21v-3a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v3M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M3 13a4 4 0 0 0-1 3v3M21 13a4 4 0 0 1 1 3v3',
    crossed: 'M5 3 21 19l-2 2L3 5V3h2ZM3 21l6-6m6-6 6-6M2 16l6 6M16 2l6 6',
    arrow: 'M4 12h16m-6-6 6 6-6 6', back: 'M20 12H4m6-6-6 6 6 6',
    check: 'm5 12 4 4 10-10', clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    lock: 'M6 10h12v11H6ZM8 10V6a4 4 0 0 1 8 0v4m-4 5v2',
    send: 'm22 2-7 20-4-9-9-4ZM22 2 11 13',
    award: 'M8 15 6 22l6-3 6 3-2-7M19 8a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
    settings: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6',
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.grid}"></path></svg>`;
  const artRoot = '../../brand/2026-09-11-pvp-patches/';
  const patch = (name, extra = '', alt = '') => `<span class="patch ${extra}"><img src="${artRoot}${name}.webp" width="512" height="512" alt="${alt}"></span>`;
  const escapeText = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const app = document.getElementById('app');
  const content = document.getElementById('content');
  const roleSelect = document.getElementById('role');
  const state = { stage: 'hub', role: 'student', ready: false, teamSize: 3, count: 10, answer: '', saved: false, locked: false, phase: 'Response', messages: [], appeal: false, judged: false };
  const isCoach = () => state.role === 'coach';
  const button = (text, attrs = '', variant = 'primary') => `<button class="ds-button ds-button-${variant}" ${attrs}>${text}</button>`;
  const matchMeta = () => `${state.teamSize}v${state.teamSize} · ${state.count} questions`;
  const format = () => isCoach() ? 'Coach-led' : 'Independent';

  function navButton(label, iconName, active = false) {
    return `<button class="nav-button" ${active ? 'aria-current="page"' : ''} data-open-nav>${icon(iconName)}<span>${label}</span></button>`;
  }
  function renderNavigation() {
    const items = isCoach() ? [['Overview', 'home'], ['Seasons', 'flag'], ['Students', 'team'], ['More', 'grid']] : [['HQ', 'home'], ['Study', 'book'], ['Honors', 'award'], ['More', 'grid']];
    document.getElementById('bottom-nav').innerHTML = items.map(([label, glyph], index) => navButton(label, glyph, index === 3)).join('');
    const desktopItems = isCoach() ? [['Overview','home'],['Seasons','flag'],['Students','team'],['Coaches','team'],['Assignments','book'],['Team Practice','crossed'],['Scripture library','book']] : [['Training HQ','home'],['Study','book'],['Honors','award'],['Team Practice','crossed']];
    document.getElementById('desktop-links').innerHTML = desktopItems.map(([label,glyph]) => label === 'Team Practice' ? `<button class="nav-button" aria-current="page" data-stage="hub">${icon(glyph)}<span>${label}</span></button>` : navButton(label,glyph)).join('') + navButton('All sections','grid');
    document.querySelector('.account-name').textContent = isCoach() ? 'Coach Alex' : 'Jordan Lee';
    document.querySelector('.account>.avatar').textContent = isCoach() ? 'AL' : 'JL';
  }
  const heading = (title, description, withArt = false) => `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div>${withArt ? patch('team-practice', 'heading-art') : '<span class="season-label">' + icon('flag') + 'Daniel 2026</span>'}</div>`;
  const context = () => `<div class="room-context">${button(icon('back') + 'All rooms', state.stage === 'live' ? 'data-exit' : 'data-stage="hub"', 'ghost')}<div class="room-meta"><span>Daniel 2026</span><span>${matchMeta()} · ${format()}</span></div></div>`;
  const footnote = () => '<p class="page-footnote">Erudoza head-to-head training · Accuracy first, teamwork throughout.</p>';

  function hub() {
    return `${heading('Team Practice', 'Study together. Answer with care. Grow in Scripture.', true)}
    <div class="hub-grid"><section class="ready-room" aria-labelledby="room-ready-title">
      <div class="room-label"><span>Daniel 2026 · ${matchMeta()}</span><span class="on-navy-badge"><span class="status-dot"></span>Lobby</span></div>
      <h2 id="room-ready-title">Your room is nearly ready.</h2><p>${isCoach() ? 'Two teams, one shared goal. Guide their next rehearsal.' : 'Gather your team. Put your preparation into practice.'}</p>
      <div class="duel"><div class="duel-team">${patch('team-a')}<strong>Team 1</strong><small>${isCoach() ? '3 players ready' : 'Your team · 2 of 3 ready'}</small></div><span class="versus">VS</span><div class="duel-team">${patch('team-b')}<strong>Team 2</strong><small>3 players ready</small></div></div>
      <div class="room-footer">${button('Open lobby' + icon('arrow'), 'data-stage="lobby"')}<span>${isCoach() ? 'Both teams are ready.' : 'You’re the owner and scribe.'}</span></div>
    </section>
    <section class="ds-panel create-room"><h2>Create a room</h2><p>Choose your format, then invite your players.</p><form id="create-room"><div class="form-grid">
      <label class="field field-wide">Season<select class="ds-input ds-select" name="season"><option>Daniel 2026</option></select></label>
      <label class="field">Team size<select class="ds-input ds-select" name="size">${[1,2,3,4,5].map(n => `<option value="${n}" ${n === state.teamSize ? 'selected' : ''}>${n}v${n}</option>`).join('')}</select></label>
      <label class="field">Match length<select class="ds-input ds-select" name="count">${[10,30,90].map(n => `<option value="${n}" ${n === state.count ? 'selected' : ''}>${n} questions</option>`).join('')}</select></label>
      <label class="field field-wide">Format<select class="ds-input ds-select" name="format"><option value="independent">Independent</option>${isCoach() ? '<option value="coached" selected>Coach-led · non-playing coach</option>' : ''}</select></label>
      </div><details class="details-field"><summary>${icon('settings')}Passage scope</summary><label class="field">Book code (optional)<input class="ds-input" name="book" placeholder="For example, DAN"></label><p>Leave empty to use all approved questions in this season.</p></details>${button('Create room', 'type="submit" class="full"')}</form></section></div>
      <div class="hub-lower"><section class="ds-panel"><div class="row-heading"><h2>Your rooms</h2><span class="small muted">2 rooms</span></div><ul class="room-list">
      <li><div><div class="list-title"><strong>Daniel 2026</strong><span class="ds-badge ds-badge-info">Lobby</span></div><p>${matchMeta()} · ${format()} · 6 players</p></div>${button('Open room', 'data-stage="lobby"', 'secondary')}</li>
      <li><div><div class="list-title"><strong>Daniel 2026</strong><span class="ds-badge ds-badge-neutral">Completed</span></div><p>3v3 · 10 questions · Independent</p></div>${button('Results', 'data-stage="results"', 'secondary')}</li></ul>
      <div class="honors-note">${patch('team-practice')}<div><h3>Teamwork worth keeping.</h3><p>Team honors follow finalized matches. Team accuracy stays separate from individual mastery.</p></div></div></section>
      <aside class="rules-block"><h2>Know the match.</h2><ul><li><strong>Accuracy leads.</strong> Correct answers can earn up to 25% extra as a speed bonus.</li><li><strong>One scribe, one final answer.</strong> Discuss together, then your scribe locks the team’s response.</li><li><strong>Prepare as a team.</strong> Both teams must be full and ready before the owner can start.</li></ul><p class="rules-note">Head-to-head scores are a training adaptation, not official PBE standings.</p></aside></div>${footnote()}`;
  }

  function roster(team) {
    const names = team === 1 ? [['Jordan Lee', 'JL'], ['Sam Rivera', 'SR'], ['Taylor Brooks', 'TB'], ['Drew Ellis', 'DE'], ['Casey Moss', 'CM']] : [['Morgan Reed', 'MR'], ['Jamie Park', 'JP'], ['Avery Cole', 'AC'], ['Robin Hart', 'RH'], ['Quinn Bell', 'QB']];
    return names.slice(0, state.teamSize).map(([name, initials], index) => {
      const you = team === 1 && index === 0 && !isCoach();
      const ready = !you || state.ready;
      const role = index === 0 ? `${you ? 'You · Owner · ' : ''}Captain · Scribe` : 'Player';
      return `<li class="${you ? 'you' : ''}"><span class="avatar">${initials}</span><div class="player-label"><strong>${name}${you ? ' · You' : ''}</strong><small>${role.replace('You · ', '')}</small></div><span class="readiness ${ready ? '' : 'preparing'}">${ready ? icon('check') : ''}${ready ? 'Ready' : 'Preparing'}</span></li>`;
    }).join('');
  }
  function lobby() {
    const allReady = state.ready || isCoach();
    return `${context()}<div class="ready-heading"><div><h1>${allReady ? 'Both teams. Ready to begin.' : 'Take your place on Team 1.'}</h1><p>${allReady ? 'The room owner can start the match.' : 'Your teammates are ready. Confirm when you are, too.'}</p></div><div class="actions">${!isCoach() ? button(state.ready ? icon('check') + 'Ready' : 'I’m ready', 'id="toggle-ready"', allReady ? 'secondary' : 'primary') : ''}${button('Start match' + icon('arrow'), `id="start-match" ${allReady ? '' : 'disabled'}`, allReady ? 'primary' : 'secondary')}</div></div>
      <div class="teams">${[1,2].map(team => `<section class="ds-panel team-card ${team === 2 ? 'team-two' : ''}"><header class="team-banner">${patch(team === 1 ? 'team-a' : 'team-b')}<div><h2>Team ${team}</h2><p>${state.teamSize} of ${state.teamSize} places filled</p><div class="team-marker"><span class="status-dot"></span>${team === 1 && !isCoach() ? 'Your team' : team === 2 ? 'Opposing team' : 'Ready for rehearsal'}</div></div></header><ul class="player-list">${roster(team)}</ul></section>`).join('')}</div>
      <div class="lobby-foot"><p>Both teams must be full and ready. Changes to the roster clear readiness.${isCoach() ? ' You lead this rehearsal as a non-playing coach.' : ' The captain can choose a different scribe before the match.'}</p>${button('Leave room', 'data-stage="hub"', 'ghost')}</div>
      <details class="lobby-details"><summary>Room setup &amp; invitations</summary><p>This room is full. Manage players or send an invitation after a place becomes available.</p><div class="form-grid"><label class="field">Player<select class="ds-input ds-select" id="manage-player"><option>Sam Rivera · Team 1</option><option>Jamie Park · Team 2</option></select></label><label class="field">Swap with<select class="ds-input ds-select" id="swap-player"><option>Jamie Park · Team 2</option><option>Sam Rivera · Team 1</option></select></label></div><div class="actions">${button('Swap teams', 'data-demo="Roster-management preview. In the app, a swap clears both teams’ readiness."', 'secondary')}${button('Manage invitations', 'data-demo="This sample room is full. Invitations become useful when a team has an open place."', 'ghost')}</div></details>${footnote()}`;
  }

  function scoreboard(results = false) {
    return `<section class="scoreboard ${results ? 'result-scoreboard' : ''}" aria-label="${results ? 'Match result' : 'Live scoreboard'}">
      <div class="score-team">${patch('team-a')}<div><h2>Team 1${!isCoach() && !results ? ' · You' : ''}</h2><div class="score">${results ? '21.50' : '12.75'}</div><div class="subscore">${results ? '18 accuracy + 3.50 speed' : '11 accuracy + 1.75 speed'}</div></div></div>
      <div class="match-center">${results ? `${icon('flag')}<p>Match complete</p>` : `<strong>Question 7 of ${state.count}</strong><p>${state.phase === 'Presentation' ? 'Read the question' : state.phase === 'Review' ? 'Question review' : state.locked ? 'Answer locked' : 'Response window'}</p><div class="question-ticks" aria-hidden="true">${Array.from({length:10},(_,i)=>`<i class="${i < 6 ? 'done' : i === 6 ? 'current' : ''}"></i>`).join('')}</div>`}</div>
      <div class="score-team">${patch('team-b')}<div><h2>Team 2</h2><div class="score">${results ? '19.25' : '11.50'}</div><div class="subscore">${results ? '17 accuracy + 2.25 speed' : '10 accuracy + 1.50 speed'}</div></div></div></section>`;
  }
  function responseBody() {
    if (state.phase === 'Review') return `<div class="ds-notice ds-notice-info"><strong>Accepted answer</strong><p style="margin:8px 0 0">Defile himself with the king’s food or wine.</p></div><p class="answer-note">Daniel 1:8 · Answer evidence is revealed during review.</p>${isCoach() ? `<form id="judge" class="appeal-form"><label class="field">Team 1 accuracy points<input class="ds-input" type="number" value="2" min="0" max="2" required></label><label class="field" style="margin-top:12px">Reason<input class="ds-input" required placeholder="Explain the judgment"></label>${button('Record judgment', 'type="submit"')}</form>` : '<p class="answer-note">Your team: 2 accuracy points + 0.35 speed bonus.</p>'}`;
    if (isCoach()) return `<div class="ds-notice ds-notice-info">${state.phase === 'Presentation' ? 'Give both teams time to read. Start the response window when they are ready.' : 'Both scribes are preparing their teams’ answers. The response window follows this question’s deadline.'}</div><p class="answer-note">You are leading this match as a non-playing coach.</p>`;
    if (state.locked) return `<div class="locked-notice"><span class="locked-icon">${icon('lock')}</span><h2>Answer locked.</h2><p>Your team’s final answer is in. Wait for the question review.</p><div class="locked-answer">${escapeText(state.answer)}</div><p>You can keep discussing with your team.</p></div>`;
    return `<form id="answer-form"><label class="answer-field"><span class="label-row">Team answer <span>You’re the scribe</span></span><textarea class="ds-input ds-textarea" id="team-answer" placeholder="Write your team’s answer…" required>${escapeText(state.answer)}</textarea></label><div class="live-actions">${button(state.saved ? icon('check') + 'Draft saved' : 'Save team draft', 'id="save-draft" type="button"', 'secondary')}${button(icon('lock') + 'Lock final answer', 'type="submit"')}</div><p class="answer-note">Locking is final. At the deadline, the latest saved draft is submitted without a speed bonus.</p></form>`;
  }
  function discussion() {
    return `<section class="ds-panel discussion"><div class="row-heading"><h2>Team 1 discussion</h2><span class="ds-badge ds-badge-neutral">Team only</span></div><div class="chat-messages" role="log" aria-label="Sample team messages"><div class="chat-message"><strong>Sam Rivera</strong><p>Think about the food and wine from the king’s table.</p></div><div class="chat-message"><strong>Taylor Brooks</strong><p>Yes — Daniel’s decision was about not defiling himself.</p></div>${state.messages.map(message => `<div class="chat-message you"><strong>${isCoach() ? 'Coach Alex' : 'Jordan Lee'} · You</strong><p>${escapeText(message)}</p></div>`).join('')}</div><form class="chat-compose" id="chat-form"><label class="sr-only" for="chat-message">Team suggestion</label><input class="ds-input" id="chat-message" placeholder="Share a suggestion…" maxlength="500" required>${button(icon('send'), 'type="submit" aria-label="Share with team"')}</form><small>Private to your team. Coaches can access discussion for moderation. Messages are retained for 30 days.</small></section>`;
  }
  function live() {
    return `${context()}${scoreboard()}<div class="live-grid"><section class="ds-panel question-panel"><div class="question-meta"><span>2 accuracy points · 30s response window</span>${state.phase === 'Response' ? `<span class="timer" role="timer" aria-label="Sample response time: 24 seconds remaining">${icon('clock')}0:24</span>` : `<span class="ds-badge ds-badge-info">${state.phase}</span>`}</div><h1>According to Daniel 1:8, what did Daniel purpose in his heart not to do?</h1><p class="question-reference">Daniel 1:8 · KJV</p>${responseBody()}</section><aside>${isCoach() ? `<section class="ds-panel coach-panel"><h2>Guide the next phase</h2><div class="phase-flow"><span class="${state.phase === 'Presentation' ? 'current' : ''}">Presentation</span>${icon('arrow')}<span class="${state.phase === 'Response' ? 'current' : ''}">Response</span>${icon('arrow')}<span class="${state.phase === 'Review' ? 'current' : ''}">Review</span></div><p>${state.phase === 'Presentation' ? 'Coach-led presentation waits for you. There is no countdown during reading.' : state.phase === 'Review' ? 'Review both teams’ answers. Record judgments before advancing.' : 'The question is open. Both teams have the same response window.'}</p>${button(state.phase === 'Presentation' ? 'Start response window' : state.phase === 'Review' ? 'Advance phase' : 'Advance phase', 'id="advance-phase" class="full"')}<p class="answer-note">${state.phase === 'Review' ? 'The concept’s sample judgment is local to this preview.' : 'Connection details and roster stay below the question.'}</p></section>` : discussion()}<details class="side-roster"><summary>Team rosters · ${state.teamSize * 2} players</summary><ul><li>Team 1 · Jordan Lee, Sam Rivera, Taylor Brooks</li><li>Team 2 · Morgan Reed, Jamie Park, Avery Cole</li></ul></details><div class="connection-note"><span class="status-dot"></span>Live connection</div></aside></div>${isCoach() ? `<details class="lobby-details"><summary>Team discussion · coach moderation</summary>${discussion()}</details>` : ''}${footnote()}`;
  }

  function results() {
    return `${context()}<header class="result-heading"><div class="result-status"><span class="ds-badge ds-badge-neutral">Completed</span><span class="ds-badge ds-badge-warning">Provisional result</span></div><h1>Team 1 leads the final score.</h1><p>Good preparation. Shared effort. Ten questions together.</p></header>${scoreboard(true)}<div class="actions result-actions">${button('Back to Team Practice', 'data-stage="hub"')}${button('Review answers' + icon('arrow'), 'data-review-answers', 'secondary')}</div>
      <div class="result-detail-grid"><section class="ds-panel"><h2>Every point, explained.</h2><table class="score-table"><thead><tr><th scope="col">Score breakdown</th><th scope="col" class="team-a-text">Team 1</th><th scope="col" class="team-b-text">Team 2</th></tr></thead><tbody><tr><td>Accuracy</td><td>18.00</td><td>17.00</td></tr><tr><td>Speed bonus</td><td>3.50</td><td>2.25</td></tr><tr><td>Total points</td><td>21.50</td><td>19.25</td></tr></tbody></table><p class="result-note">Correct answers earn up to 25% extra. Speed uses server-observed elapsed time, including network transit.</p></section><aside class="ds-panel"><h2>Make the next practice count.</h2><p>Revisit the wording in Daniel 1:8, then bring that confidence to your next match.</p>${!isCoach() ? button('Review this season individually', 'data-demo="This would open your existing individual season review, keeping the selected season."', 'secondary') : button('Review team answers', 'data-review-answers', 'secondary')}<p class="result-note">One appeal is still open. Results and team honors finalize after outstanding appeals are resolved.</p></aside></div>
      <section class="ds-panel" id="answer-review" tabindex="-1" style="margin-top:24px"><div class="row-heading"><h2>Answer review</h2><span class="small muted">Team 1</span></div>
      <details class="review-answer"><summary><span>7</span><strong>Daniel’s decision · Daniel 1:8</strong><small>2 / 2 accuracy</small></summary><div class="answer-detail"><p><strong>Question:</strong> What did Daniel purpose in his heart not to do?</p><p><strong>Submitted:</strong> Defile himself with the king’s food or wine.</p><p><strong>Accepted:</strong> Defile himself with the portion of the king’s meat, nor with the wine which he drank.</p><p>2 accuracy points · 0.35 speed bonus · 9.00s server-observed</p>${isCoach() ? button('Review judgment', 'data-demo="Coach judgment includes accuracy points and a required reason. This preview keeps the recorded example unchanged."', 'secondary') : `<details><summary>Request an appeal</summary><form class="appeal-form" id="appeal-form"><label class="field">Explain the request<textarea class="ds-input" required maxlength="500" placeholder="Tell your coach what should be reviewed."></textarea></label>${button(state.appeal ? 'Appeal pending' : 'Request review', `type="submit" ${state.appeal ? 'disabled' : ''}`)}</form></details>`}</div></details>
      <details class="review-answer"><summary><span>8</span><strong>The ten-day test · Daniel 1:12</strong><small style="color:var(--er-warning-ink)">Appeal pending</small></summary><div class="answer-detail"><p>A coach will review the submitted wording and the question’s accepted answers.</p><p>Final score and team honors remain provisional until the appeal is resolved.</p></div></details></section>${footnote()}`;
  }

  function artwork() {
    return `${heading('A team identity you can feel.', 'Original embroidered artwork proposed for Team Practice.')}
      <p class="small muted" style="max-width:65ch;margin-bottom:28px">The approved patch family carries through the hub, team rosters, scoreboard and results. Hover across each patch to try the gentle lift, dip and soft shadow. Touch and reduced motion stay at rest.</p>
      <div class="artwork-grid">${[['team-a','Team 1','Teal mountain shield'],['team-b','Team 2','Coral Bible shield'],['team-practice','Team Practice','Shared practice emblem']].map(([file,title,desc]) => `<section class="artwork-card"><div class="artwork-surface">${patch(file,'',desc)}</div><div class="artwork-caption"><h2>${title}</h2><p>${desc}</p></div></section>`).join('')}</div>
      <section class="artwork-alt"><div><h2>Works on the academy canvas, too.</h2><p>True transparent edges keep the embroidered contour and shadow intact on ivory.</p></div><div class="artwork-inline">${patch('team-a')}${patch('team-b')}${patch('team-practice')}</div></section><p class="page-footnote">Proposed team identity artwork. These are not earned Honors or official Pathfinder insignia.</p>`;
  }

  function render() {
    resetPatches();
    app.classList.toggle('live-mode', state.stage === 'live');
    document.querySelectorAll('.review-stages [data-stage]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.stage === state.stage)));
    renderNavigation();
    content.innerHTML = ({hub,lobby,live,results,artwork}[state.stage])();
    const formatSelect = content.querySelector('select[name="format"]');
    if (formatSelect) {
      formatSelect.innerHTML = `<option>${isCoach() ? 'Coach-led · non-playing coach' : 'Independent'}</option>`;
      formatSelect.disabled = true;
      formatSelect.setAttribute('aria-label', `Format: ${format()}. Fixed for this illustrative ${isCoach() ? 'Coach' : 'Student'} scenario.`);
    }
    const responsePreview = document.getElementById('preview-response-end');
    responsePreview.hidden = !(isCoach() && state.stage === 'live' && state.phase === 'Response');
    if (isCoach()) {
      content.querySelectorAll('.chat-compose').forEach(form => form.remove());
      content.querySelectorAll('.discussion .ds-badge').forEach(badge => {badge.textContent = 'Read-only moderation';});
    }
    const advance = document.getElementById('advance-phase');
    if (advance && state.phase === 'Response') {
      advance.disabled = true;
      advance.title = 'The response window must finish before review';
      advance.textContent = 'Waiting for response window';
    }
    if (advance && state.phase === 'Review') {
      advance.disabled = !state.judged;
      advance.title = state.judged ? 'Continue to the next question' : 'Record the sample judgment before advancing';
      const otherJudgment = document.createElement('p');
      otherJudgment.className = 'answer-note';
      otherJudgment.textContent = 'Team 2: 2 accuracy points · judgment already recorded. Team 1 is the remaining judgment.';
      document.getElementById('judge')?.before(otherJudgment);
    }
    const resultTitle = content.querySelector('.result-heading h1');
    if (resultTitle) resultTitle.textContent = 'Team 1 leads on points.';
    const resultDescription = content.querySelector('.result-heading>p');
    if (resultDescription) resultDescription.textContent = `Good preparation. Shared effort. ${state.count} questions together.`;
    const teamSummaries = content.querySelectorAll('.duel-team>small');
    if (teamSummaries.length) {
      teamSummaries[0].textContent = isCoach() ? `${state.teamSize} players ready` : `Your team · ${state.teamSize - (state.ready ? 0 : 1)} of ${state.teamSize} ready`;
      teamSummaries[1].textContent = `${state.teamSize} players ready`;
    }
    const roomRows = content.querySelectorAll('.room-list li p');
    if (roomRows.length) {
      roomRows[0].textContent = `${matchMeta()} · ${format()} · ${state.teamSize * 2} players`;
      roomRows[1].textContent = `${matchMeta()} · ${format()}`;
    }
    const liveRoster = content.querySelector('.side-roster ul');
    if (liveRoster) liveRoster.innerHTML = `<li>Team 1 · ${state.teamSize} ${state.teamSize === 1 ? 'player' : 'players'}</li><li>Team 2 · ${state.teamSize} ${state.teamSize === 1 ? 'player' : 'players'}</li>`;
    if (state.teamSize === 1) content.querySelectorAll('.chat-messages').forEach(log => {log.innerHTML = '<p class="small muted">You are Team 1’s only player in this 1v1.</p>';});
    document.querySelectorAll('[data-icon]').forEach(el => { el.outerHTML = icon(el.dataset.icon); });
  }
  function go(stage) {
    if (!['hub','lobby','live','results','artwork'].includes(stage)) return;
    state.stage = stage;
    if (stage === 'live') { state.phase = isCoach() ? 'Presentation' : 'Response'; state.locked = false; }
    render();
    window.scrollTo({top:0, behavior:'instant'});
    history.replaceState(null, '', `#${stage}`);
  }
  let announcementTimer;
  function announce(message) {
    const box = document.getElementById('announcement');
    box.textContent = message; box.hidden = false;
    clearTimeout(announcementTimer);
    announcementTimer = setTimeout(() => {box.hidden = true;}, 4500);
  }
  function navItems() {
    const names = isCoach() ? ['Overview', 'Seasons', 'Students', 'Coaches', 'Assignments', 'Team Practice', 'Scripture library'] : ['Training HQ', 'Study', 'Honors', 'Progress', 'Team Practice'];
    const query = document.getElementById('nav-search').value.trim().toLowerCase();
    const matches = names.filter(name => name.toLowerCase().includes(query));
    document.getElementById('nav-items').innerHTML = matches.length ? matches.map(name => button(name, name === 'Team Practice' ? 'data-nav-practice' : `data-demo="${name} is a stable destination in the proposed navigation. This preview focuses on Team Practice."`, 'ghost')).join('') : '<p class="small muted">No matching sections.</p>';
  }
  document.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.stage) go(target.dataset.stage);
    if (target.hasAttribute('data-close')) target.closest('dialog').close();
    if (target.hasAttribute('data-open-nav')) { document.getElementById('nav-search').value = '';navItems();document.getElementById('nav-dialog').showModal();document.getElementById('nav-search').focus(); }
    if (target.hasAttribute('data-nav-practice')) {document.getElementById('nav-dialog').close();go('hub');}
    if (target.dataset.demo) announce(target.dataset.demo);
    if (target.hasAttribute('data-account')) announce(`Sample account: ${isCoach() ? 'Coach Alex · non-playing coach' : 'Jordan Lee · Student'}. No real account is connected.`);
    if (target.hasAttribute('data-exit')) document.getElementById('exit-dialog').showModal();
    if (target.id === 'confirm-exit') {document.getElementById('exit-dialog').close();go('hub');}
    if (target.id === 'toggle-ready') {state.ready = !state.ready;render();document.getElementById('toggle-ready').focus();}
    if (target.id === 'start-match') go('live');
    if (target.id === 'save-draft') {state.answer = document.getElementById('team-answer').value;state.saved = true;target.innerHTML = icon('check') + 'Draft saved';announce('Team draft saved in this preview.');}
    if (target.id === 'advance-phase') {state.phase = state.phase === 'Presentation' ? 'Response' : state.phase === 'Response' ? 'Review' : 'Presentation';state.judged = false;render();announce(state.phase === 'Response' ? 'Preview skips the short synchronized start. Both scribes acknowledge it in the app.' : `${state.phase} phase preview.`);}
    if (target.id === 'preview-response-end') {state.phase = 'Review';state.judged = false;render();announce('Reviewing the sample after its response deadline.');}
    if (target.hasAttribute('data-review-answers')) { const section = document.getElementById('answer-review');section.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth',block:'start'});section.querySelector('details').open = true;section.focus({preventScroll:true}); }
  });
  document.addEventListener('submit', event => {
    event.preventDefault();
    if (event.target.id === 'create-room') {const values = new FormData(event.target);state.teamSize = Number(values.get('size'));state.count = Number(values.get('count'));state.ready = false;go('lobby');announce('Sample lobby opened. Players are illustrative; no real room was created.');}
    if (event.target.id === 'answer-form') {state.answer = document.getElementById('team-answer').value;state.locked = true;render();announce('Answer locked in this preview.');}
    if (event.target.id === 'chat-form') {state.messages.push(document.getElementById('chat-message').value);state.answer = document.getElementById('team-answer')?.value || state.answer;render();document.getElementById('chat-message').focus();}
    if (event.target.id === 'appeal-form') {state.appeal = true;event.target.querySelector('button').disabled = true;event.target.querySelector('button').textContent = 'Appeal pending';announce('Appeal preview recorded locally. Nothing was sent.');}
    if (event.target.id === 'judge') {state.judged = true;announce('Sample judgment recorded locally. No match data was changed.');event.target.querySelector('button').textContent = 'Judgment recorded';document.getElementById('advance-phase').disabled = false;}
  });
  roleSelect.addEventListener('change', () => {state.role = roleSelect.value;state.phase = isCoach() ? 'Presentation' : 'Response';state.locked = false;state.messages = [];render();});
  document.getElementById('nav-search').addEventListener('input', navItems);
  document.addEventListener('keydown', event => {if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {event.preventDefault();document.querySelector('[data-open-nav]').click();}});

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const patchStates = new Map();
  let patchFrame = 0;
  function resetPatches() {cancelAnimationFrame(patchFrame);patchFrame=0;patchStates.forEach((_, el) => {el.querySelector('img').style.transform = '';el.querySelector('img').style.filter = '';});patchStates.clear();}
  function animatePatches() {
    patchFrame = 0;
    let unsettled = false;
    patchStates.forEach((value, el) => {
      value.x += (value.tx - value.x) * .16; value.y += (value.ty - value.y) * .16; value.lift += (value.tlift - value.lift) * .16;
      const img = el.querySelector('img');
      img.style.transform = `translateY(${-value.lift}px) rotateX(${value.y}deg) rotateY(${value.x}deg) scale(${1+value.lift*.004})`;
      img.style.filter = `drop-shadow(0 2px 2px #07182724) drop-shadow(${-value.x*.75}px ${7+value.lift}px ${9+value.lift*.8}px #07182740)`;
      if (Math.abs(value.tx-value.x)+Math.abs(value.ty-value.y)+Math.abs(value.tlift-value.lift) > .025) unsettled=true;
      else if (!value.tlift) {img.style.transform='';img.style.filter='';patchStates.delete(el);}
    });
    if (unsettled) patchFrame=requestAnimationFrame(animatePatches);
  }
  document.addEventListener('pointermove', event => {
    if (reduced.matches || !fine.matches || event.pointerType === 'touch') return;
    const el = event.target.closest('.patch');
    patchStates.forEach((value, current) => {if(current!==el){value.tx=0;value.ty=0;value.tlift=0;}});
    if(el){const rect=el.getBoundingClientRect();const value=patchStates.get(el)||{x:0,y:0,lift:0};value.tx=-((event.clientX-rect.left)/rect.width-.5)*12;value.ty=((event.clientY-rect.top)/rect.height-.5)*12;value.tlift=Math.max(2,Math.min(5,rect.width*.035));patchStates.set(el,value);}
    if(!patchFrame && patchStates.size)patchFrame=requestAnimationFrame(animatePatches);
  });
  document.documentElement.addEventListener('pointerleave', resetPatches);
  window.addEventListener('blur',resetPatches);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)resetPatches();});
  reduced.addEventListener('change',resetPatches);fine.addEventListener('change',resetPatches);
  const initial = location.hash.slice(1);
  if(['hub','lobby','live','results','artwork'].includes(initial))state.stage=initial;
  render();
})();
