// The website's behaviour. All data and logic (educations, jobs, suggestions, the test)
// come from the app's own code in engine.js, so the website works exactly like the app.
(function () {
  'use strict';

  const F = window.FK;

  // The AI routes run on the app's server. While trying the site out locally, use the local one.
  const ApiOrigin = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? 'http://localhost:8081'
    : 'https://fremtidskompasset.expo.app';

  /**
   * The app's server doesn't allow requests from other sites (CORS), so the chat goes through a
   * small hidden page on that server (public/chat-bridge.html), which we talk to with postMessage.
   */
  const bridge = (() => {
    let frame = null;
    let ready = null;
    let nextId = 1;
    const pending = new Map();

    window.addEventListener('message', (event) => {
      if (event.origin !== ApiOrigin) return;
      const data = event.data || {};
      const resolve = pending.get(data.id);
      if (!resolve) return;
      pending.delete(data.id);
      resolve(data);
    });

    function load() {
      if (ready) return ready;
      ready = new Promise((resolve, reject) => {
        frame = document.createElement('iframe');
        frame.src = ApiOrigin + '/chat-bridge.html';
        frame.title = 'Forbindelse til AI-guiden';
        frame.hidden = true;
        const timer = setTimeout(() => {
          ready = null;
          frame.remove();
          reject(new TypeError('timeout'));
        }, 15000);
        const onReady = (event) => {
          if (event.origin !== ApiOrigin || !event.data || event.data.fremtidskompassetBridge !== 'ready') return;
          window.removeEventListener('message', onReady);
          clearTimeout(timer);
          resolve();
        };
        window.addEventListener('message', onReady);
        document.body.appendChild(frame);
      });
      return ready;
    }

    return {
      async post(endpoint, body) {
        await load();
        const id = nextId++;
        const result = await new Promise((resolve) => {
          pending.set(id, resolve);
          frame.contentWindow.postMessage({ id, endpoint, body }, ApiOrigin);
        });
        if (result.network) throw new TypeError('network');
        return result;
      },
    };
  })();

  const $ = (id) => document.getElementById(id);
  const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const words = (query) => F.normalize(query).split(/\s+/).filter(Boolean);
  const scrollBehavior = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
  const goTo = (id) => $(id).scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  const levelOf = (id) => F.Levels.find((level) => level.id === id);

  /** Browser storage can be blocked or full. The site still works, it just forgets on reload. */
  const store = {
    get(key, fallback) {
      try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Keep it in memory only.
      }
    },
  };

  // ---------------------------------------------------------------- Favourites
  const StarIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  let favorites = store.get('fk-favorites', []);

  const programKey = (direction, program) => `program:${direction.id}:${program.name}`;
  const jobKey = (job) => `job:${job.id}`;
  const isFavorite = (key) => favorites.includes(key);

  function starLabel(key, name) {
    return isFavorite(key) ? `Fjern ${name} fra favoritter` : `Gem ${name} som favorit`;
  }

  function star(key, name) {
    return `<button class="star" type="button" data-fav="${esc(key)}" data-fav-name="${esc(name)}"
      aria-pressed="${isFavorite(key)}" aria-label="${esc(starLabel(key, name))}">${StarIcon}</button>`;
  }

  function toggleFavorite(key) {
    favorites = isFavorite(key) ? favorites.filter((k) => k !== key) : [...favorites, key];
    store.set('fk-favorites', favorites);
    document.querySelectorAll('[data-fav]').forEach((button) => {
      if (button.dataset.fav !== key) return;
      button.setAttribute('aria-pressed', String(isFavorite(key)));
      button.setAttribute('aria-label', starLabel(key, button.dataset.favName));
    });
    renderFavorites();
  }

  /** Turns a saved key back into the education or job it points to. */
  function resolveFavorite(key) {
    if (key.startsWith('job:')) {
      const job = F.getJob(key.slice(4));
      return job && { kind: 'job', job };
    }
    if (key.startsWith('program:')) {
      const rest = key.slice(8);
      const split = rest.indexOf(':');
      const direction = F.getDirection(rest.slice(0, split));
      const program = direction && direction.programs.find((p) => p.name === rest.slice(split + 1));
      return program && { kind: 'program', direction, program };
    }
    return null;
  }

  function renderFavorites() {
    const items = favorites.map(resolveFavorite).filter(Boolean);
    $('fav-count').textContent = items.length ? String(items.length) : '';
    $('favorites').innerHTML = items.length === 0
      ? `<div class="empty"><b>Du har ingen favoritter endnu</b><p class="muted">Tryk på ☆ ved en uddannelse eller et job, så bliver den gemt her.</p></div>`
      : `<div class="fav-list">${items.map((item) => item.kind === 'job'
        ? jobCard(item.job)
        : programCard(item.direction, item.program, { showDirection: true })).join('')}</div>`;
  }

  // ---------------------------------------------------------------- Shared cards
  function programCard(direction, program, { showDirection = false, highlight = false } = {}) {
    return `<article class="program${highlight ? ' highlight' : ''}" style="--dir:${direction.color}" data-program="${esc(program.name)}">
      <div class="program-head">
        <div>
          ${showDirection ? `<button class="link-btn from" type="button" data-open-direction="${direction.id}" data-open-program="${esc(program.name)}">${esc(direction.title)} ›</button>` : ''}
          <h4>${esc(program.name)}</h4>
        </div>
        ${star(programKey(direction, program), program.name)}
      </div>
      <p>${esc(program.description)}</p>
      ${program.requirements ? `<p class="meta"><b>Krav:</b> ${esc(program.requirements)}</p>` : ''}
      ${program.grade ? `<p class="meta"><b>Snit:</b> ${esc(program.grade)}</p>` : ''}
    </article>`;
  }

  function jobCard(job) {
    const color = F.JobCategoryColors[job.category];
    const directions = job.directions.map(F.getDirection).filter(Boolean);
    return `<details class="job" style="--job:${color}">
      <summary>
        <span class="badge" aria-hidden="true">${esc(job.name[0])}</span>
        <span class="stack" style="gap:2px">
          <h4>${esc(job.name)}</h4>
          <span class="cat">${esc(job.category)}</span>
          <p>${esc(job.description)}</p>
          <span class="more">Sådan bliver du ${esc(job.name.toLocaleLowerCase('da-DK'))} ›</span>
        </span>
      </summary>
      <div class="job-details">
        <b>Sådan bliver du ${esc(job.name.toLocaleLowerCase('da-DK'))}</b>
        <p>${esc(job.education)}</p>
        <div class="go-chips">${directions.map((d) => `<button class="go-chip" type="button" data-open-direction="${d.id}">Læs om ${esc(d.title)} ›</button>`).join('')}</div>
      </div>
      ${star(jobKey(job), job.name)}
    </details>`;
  }

  // ---------------------------------------------------------------- Explorer
  const explorer = { level: 'ungdomsuddannelse', direction: null, program: null };

  function renderLevelTabs() {
    $('level-tabs').innerHTML = F.Levels.map((level) => `
      <button class="pill" role="tab" type="button" data-level="${level.id}"
        aria-selected="${level.id === explorer.level}" style="--pill:${level.color}">
        <span class="dot"></span>${esc(level.title)}
      </button>`).join('');
  }

  function renderDirectionList() {
    const list = $('dir-list');
    const directions = F.Directions.filter((d) => d.level === explorer.level);
    list.parentElement.classList.toggle('single', directions.length === 0);
    list.hidden = directions.length === 0;
    list.innerHTML = directions.map((d) => `
      <button class="dir-card" type="button" data-direction="${d.id}"
        aria-pressed="${d.id === explorer.direction}" style="--dir:${d.color}">
        <span class="badge">${esc(d.letter)}</span>
        <span><b>${esc(d.title)}</b><small>${esc(d.duration)} · ${d.programs.length} uddannelser og job</small></span>
      </button>`).join('');
  }

  function renderDirectionDetail() {
    const detail = $('detail');
    if (explorer.level === 'andet') {
      detail.style.setProperty('--dir', levelOf('andet').color);
      detail.innerHTML = `
        <div class="detail-head"><span class="badge">?</span><h3>Hvem er du, og hvad passer til dig?</h3></div>
        <p>Det er helt normalt ikke at vide, hvad man vil. Her kan du finde ud af, hvad der passer til dig.</p>
        <div class="hub">
          <a class="hub-card" href="#test" style="background:#4A90E2"><b>Tag personlighedstesten</b><span>Svar på 12 spørgsmål og se, hvilken persona du er, og hvilke uddannelser der passer til dig.</span></a>
          <a class="hub-card" href="#ai" data-chat="persona" style="background:#B44E6B"><b>Spørg AI-vejlederen</b><span>Chat med en AI om dine interesser og styrker, og undersøg, hvad der kunne passe til dig.</span></a>
          <a class="hub-card" href="#ordbog" style="background:#347E83"><b>Ordbog</b><span>Hvad betyder merit, A-niveau, kvote 2 og SU? Få forklaret de ord, der bruges om uddannelse.</span></a>
        </div>`;
      return;
    }

    const d = F.getDirection(explorer.direction);
    detail.style.setProperty('--dir', d.color);
    detail.innerHTML = `
      <div class="detail-head"><span class="badge">${esc(d.letter)}</span><h3>${esc(d.title)}</h3></div>
      <p>${esc(d.summary)}</p>
      <dl class="facts">
        <dt>Varighed</dt><dd>${esc(d.duration)}</dd>
        <dt>Det fører til</dt><dd>${esc(d.leadsTo)}</dd>
      </dl>
      <div>
        <p class="label">Sådan kommer du ind</p>
        <ul class="rules">${d.admission.map((rule) => `<li>${esc(rule)}</li>`).join('')}</ul>
      </div>
      <div>
        <p class="label">Dine muligheder</p>
        <div class="programs">${d.programs.map((p) => programCard(d, p, { highlight: p.name === explorer.program })).join('')}</div>
      </div>
      <div>
        <p class="label">Måske noget for dig, hvis</p>
        <ul class="rules">${d.goodFor.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
      </div>`;
  }

  function renderExplorer() {
    renderLevelTabs();
    renderDirectionList();
    renderDirectionDetail();
  }

  function selectLevel(levelId) {
    explorer.level = levelId;
    const first = F.Directions.find((d) => d.level === levelId);
    explorer.direction = first ? first.id : null;
    explorer.program = null;
    renderExplorer();
  }

  /** Opens a direction in the explorer, optionally with one program highlighted. */
  function openDirection(directionId, programName) {
    const direction = F.getDirection(directionId);
    if (!direction) return;
    explorer.level = direction.level;
    explorer.direction = direction.id;
    explorer.program = programName || null;
    renderExplorer();
    const target = programName && $('detail').querySelector('.program.highlight');
    (target || $('udforsk')).scrollIntoView({ behavior: scrollBehavior(), block: target ? 'center' : 'start' });
  }

  $('level-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-level]');
    if (button) selectLevel(button.dataset.level);
  });

  $('dir-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-direction]');
    if (!button) return;
    explorer.direction = button.dataset.direction;
    explorer.program = null;
    renderDirectionList();
    renderDirectionDetail();
    if (window.matchMedia('(max-width: 900px)').matches) {
      $('detail').scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    }
  });

  // ---------------------------------------------------------------- Search
  function searchJobs(query) {
    const w = words(query);
    if (w.length === 0) return [];
    return F.Jobs
      .map((job) => ({ job, score: F.score(w, job.name, [job.category, job.description, job.education]) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.job);
  }

  function renderSearch() {
    const query = $('search-input').value;
    const out = $('search-results');
    if (!query.trim()) {
      out.innerHTML = '';
      return;
    }
    const results = F.searchEducations(query);
    const directions = results.filter((r) => r.kind === 'direction');
    const programs = results.filter((r) => r.kind === 'program').slice(0, 12);
    const jobs = searchJobs(query).slice(0, 8);

    if (directions.length + programs.length + jobs.length === 0) {
      out.innerHTML = `<div class="empty"><b>Ingen resultater for “${esc(query.trim())}”</b><p class="muted">Prøv et andet ord, fx et fag eller et job.</p></div>`;
      return;
    }

    const groups = [];
    if (directions.length) {
      groups.push(`<div class="result-group"><h3>Retninger</h3><div class="result-list">${directions.map(({ direction: d }) => `
        <button class="dir-card" type="button" data-open-direction="${d.id}" style="--dir:${d.color}">
          <span class="badge">${esc(d.letter)}</span>
          <span><b>${esc(d.title)}</b><small>${esc(levelOf(d.level).title)} · ${esc(d.duration)}</small></span>
        </button>`).join('')}</div></div>`);
    }
    if (programs.length) {
      groups.push(`<div class="result-group"><h3>Uddannelser</h3><div class="result-list">${programs.map(({ direction, program }) => programCard(direction, program, { showDirection: true })).join('')}</div></div>`);
    }
    if (jobs.length) {
      groups.push(`<div class="result-group"><h3>Jobs</h3><div class="job-list">${jobs.map(jobCard).join('')}</div></div>`);
    }
    out.innerHTML = groups.join('');
  }

  $('search-input').addEventListener('input', renderSearch);

  // ---------------------------------------------------------------- Profile and suggestions
  const EmptyProfile = { name: '', age: '', interests: [], favoriteSubjects: [], dreamJob: '', about: '' };
  let profile = { ...EmptyProfile, ...store.get('fk-profile', {}) };

  function updateProfile(changes) {
    profile = { ...profile, ...changes };
    store.set('fk-profile', profile);
    renderCompleteness();
    renderRecommendations();
  }

  const toggle = (list, item) => (list.includes(item) ? list.filter((i) => i !== item) : [...list, item]);

  function pills(options, isOn) {
    return options.map((option) => `<button class="pill" type="button" data-value="${esc(option)}" aria-pressed="${isOn(option)}">${esc(option)}</button>`).join('');
  }

  function renderProfilePills() {
    $('p-status').innerHTML = pills(F.Statuses, (o) => profile.status === o);
    $('p-region').innerHTML = pills(F.Regions, (o) => profile.region === o);
    const interests = [...F.Interests, ...profile.interests.filter((i) => !F.Interests.includes(i))];
    $('p-interests').innerHTML = pills(interests, (o) => profile.interests.includes(o));
    $('p-subjects').innerHTML = pills(F.Subjects, (o) => profile.favoriteSubjects.includes(o));
  }

  function renderCompleteness() {
    // Like the app, but without the profile photo, which the website doesn't have.
    const filled = [
      profile.name.trim(), profile.age.trim(), profile.status, profile.region,
      profile.interests.length > 0, profile.favoriteSubjects.length > 0, profile.dreamJob.trim(), profile.about.trim(),
    ].filter(Boolean).length;
    const percent = Math.round((filled / 8) * 100);
    $('profile-meter').style.width = `${percent}%`;
    $('profile-percent').textContent = percent === 100 ? 'Din profil er helt udfyldt 🎉' : `Din profil er ${percent}% udfyldt`;
  }

  function renderRecommendations() {
    const out = $('recommendations');
    if (!F.canRecommend(profile)) {
      out.innerHTML = '<p class="small muted">Vælg nogle interesser eller yndlingsfag, eller skriv dit drømmejob, så kommer der forslag her.</p>';
      return;
    }
    const recs = F.recommend(profile);
    if (recs.length === 0) {
      out.innerHTML = '<p class="small muted">Vi har ikke fundet noget, der passer endnu. Prøv at vælge flere interesser eller fag.</p>';
      return;
    }
    out.innerHTML = recs.map(({ direction, program, reason }) => `
      <article class="rec" style="--dir:${direction.color}">
        <span class="badge">${esc(direction.letter)}</span>
        <div class="stack" style="gap:4px">
          <h4>${esc(program.name)}</h4>
          <button class="link-btn small" type="button" data-open-direction="${direction.id}" data-open-program="${esc(program.name)}">${esc(direction.title)} ›</button>
          <p class="reason">${esc(reason)}</p>
        </div>
        ${star(programKey(direction, program), program.name)}
      </article>`).join('');
  }

  function bindPills(id, onPick) {
    $(id).addEventListener('click', (event) => {
      const button = event.target.closest('[data-value]');
      if (!button) return;
      onPick(button.dataset.value);
      renderProfilePills();
    });
  }

  bindPills('p-status', (v) => updateProfile({ status: profile.status === v ? undefined : v }));
  bindPills('p-region', (v) => updateProfile({ region: profile.region === v ? undefined : v }));
  bindPills('p-interests', (v) => updateProfile({ interests: toggle(profile.interests, v) }));
  bindPills('p-subjects', (v) => updateProfile({ favoriteSubjects: toggle(profile.favoriteSubjects, v) }));

  const textFields = { 'p-name': 'name', 'p-age': 'age', 'p-dream': 'dreamJob', 'p-about': 'about' };
  Object.entries(textFields).forEach(([id, field]) => {
    $(id).value = profile[field] || '';
    $(id).addEventListener('input', () => updateProfile({ [field]: $(id).value }));
  });

  function addOwnInterest() {
    const input = $('p-own-interest');
    const interest = input.value.trim();
    if (!interest) return;
    if (!profile.interests.includes(interest)) updateProfile({ interests: [...profile.interests, interest] });
    input.value = '';
    renderProfilePills();
  }
  $('p-add-interest').addEventListener('click', addOwnInterest);
  $('p-own-interest').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addOwnInterest();
    }
  });
  $('profile-form').addEventListener('submit', (event) => event.preventDefault());

  // ---------------------------------------------------------------- Personality test
  const test = { levels: undefined, answers: [] };
  const TotalSteps = F.Questions.length + 1;

  function renderTest() {
    const card = $('test-card');
    const done = test.levels !== undefined && test.answers.length === F.Questions.length;

    if (done) {
      const result = F.buildResult(F.scoreAnswers(test.answers), test.levels);
      card.innerHTML = `
        <div class="persona-card" style="background:${result.trait.color}">
          <small>Din persona</small>
          <b>${esc(result.trait.persona)}</b>
          <p>${esc(result.trait.description)}</p>
        </div>
        <p class="label">Dine træk</p>
        <div class="stack" style="gap:8px">${result.shares.map(({ trait, share }) => `
          <div class="trait"><span>${esc(trait.label)}</span><div class="meter"><span style="width:${share}%;background:${trait.color}"></span></div><span>${share}%</span></div>`).join('')}
        </div>
        <p class="label">Uddannelser, der passer til dig</p>
        <div class="stack" style="gap:8px">${result.matches.map(({ direction, match }) => `
          <button class="match" type="button" data-open-direction="${direction.id}" style="background:${direction.color}"><b>${esc(direction.title)}</b><span>${match}% match</span></button>`).join('')}
        </div>
        <div class="row-actions">
          <button class="btn btn-primary" type="button" id="test-chat">Snak med AI-vejlederen om dit resultat</button>
          <button class="link-btn" type="button" id="test-restart">Tag testen igen</button>
        </div>
        <p class="small muted">Testen er kun et udgangspunkt. Tal også med en uddannelsesvejleder.</p>`;
      $('test-chat').addEventListener('click', () => {
        openChat('persona', F.describeResult(result));
      });
      $('test-restart').addEventListener('click', () => {
        test.levels = undefined;
        test.answers = [];
        renderTest();
      });
      return;
    }

    const step = test.levels === undefined ? 0 : test.answers.length + 1;
    const question = test.levels === undefined ? F.LevelQuestion : F.Questions[test.answers.length];
    card.innerHTML = `
      <div class="progress">
        <div class="meter"><span style="width:${(step / TotalSteps) * 100}%"></span></div>
        <span class="small muted">${step + 1} af ${TotalSteps}</span>
      </div>
      <h3>${esc(question.text)}</h3>
      <div class="answers">${question.answers.map((answer, i) => `<button class="answer" type="button" data-answer="${i}">${esc(answer.text)}</button>`).join('')}</div>
      ${step > 0 ? '<button class="link-btn" type="button" id="test-back">Forrige spørgsmål</button>' : ''}`;

    card.querySelectorAll('[data-answer]').forEach((button) => {
      button.addEventListener('click', () => {
        const answer = question.answers[Number(button.dataset.answer)];
        if (test.levels === undefined) test.levels = answer.levels;
        else test.answers.push(answer);
        renderTest();
        card.querySelector('h3, .persona-card')?.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' });
      });
    });
    $('test-back')?.addEventListener('click', () => {
      if (test.answers.length > 0) test.answers.pop();
      else test.levels = undefined;
      renderTest();
    });
  }

  // ---------------------------------------------------------------- Jobs
  const jobsState = { tab: 'jobs', query: '' };

  function genericSearch(items, query, fields) {
    const w = words(query);
    if (w.length === 0) return items;
    return items
      .map((item) => ({ item, score: F.score(w, ...fields(item)) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.item);
  }

  function placementCard(placement) {
    const apprenticeship = placement.kind === 'Læreplads';
    return `<article class="placement">
      <div class="placement-head"><h4>${esc(placement.name)}</h4><span class="kind" style="background:${apprenticeship ? '#347E83' : '#3F5F9E'}">${esc(placement.kind)}</span></div>
      <p>${esc(placement.description)}</p>
      <p class="small muted">Fx ${esc(placement.examples.join(', '))}</p>
      ${apprenticeship ? `<div class="go-chips"><a class="go-chip" href="${F.JobLinks.laerepladsen}" target="_blank" rel="noopener">Find ledige lærepladser ↗</a></div>` : ''}
    </article>`;
  }

  const PlacementIntro = `<div class="intro-card">
    <h4>Hvad er forskellen?</h4>
    <p><b>Læreplads:</b> På en erhvervsuddannelse eller EUX skal du have en uddannelsesaftale med en virksomhed for at komme på hovedforløbet. Du får løn, mens du er i lære.</p>
    <p><b>Praktik:</b> På mange videregående uddannelser er der en periode, hvor du arbejder i en virksomhed eller institution som en del af studiet.</p>
    <p class="muted">Finder du ikke en læreplads, kan du på mange fag komme i skoleoplæring. Spørg din erhvervsskole.</p>
  </div>`;

  function renderJobs() {
    const isJobs = jobsState.tab === 'jobs';
    document.querySelectorAll('[data-jobs-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.jobsTab === jobsState.tab)));
    const input = $('jobs-input');
    input.placeholder = isJobs ? 'Søg efter job, fx kok eller læge' : 'Søg efter fag, fx tømrer';
    input.setAttribute('aria-label', isJobs ? 'Søg efter job' : 'Søg efter praktik og lærepladser');

    const hasQuery = jobsState.query.trim().length > 0;
    const items = isJobs
      ? genericSearch(F.Jobs, jobsState.query, (j) => [j.name, [j.category, j.description, j.education]])
      : genericSearch(F.Placements, jobsState.query, (p) => [p.name, [p.kind, p.description, ...p.examples]]);

    $('jobs-count').textContent = hasQuery && items.length > 0 ? (items.length === 1 ? '1 resultat' : `${items.length} resultater`) : '';
    const list = isJobs ? items.map(jobCard) : items.map(placementCard);
    if (!isJobs && !hasQuery) list.unshift(PlacementIntro);
    $('job-list').innerHTML = hasQuery && items.length === 0
      ? `<div class="empty" style="grid-column:1/-1"><b>Ingen resultater for “${esc(jobsState.query.trim())}”</b><p class="muted">Prøv et andet ord, eller se alle ledige stillinger via linket nedenfor.</p></div>`
      : list.join('');

    $('jobs-footer').innerHTML = isJobs
      ? `<p class="muted">Vil du se ledige stillinger eller læse mere om et job?</p><div class="go-chips"><a class="go-chip" href="${F.JobLinks.jobnet}" target="_blank" rel="noopener">Jobnet ↗</a><a class="go-chip" href="${F.JobLinks.ug}" target="_blank" rel="noopener">UddannelsesGuiden ↗</a></div>`
      : `<p class="muted">Ledige lærepladser findes på Lærepladsen.dk. Praktik på videregående uddannelser finder du via dit studiested.</p><div class="go-chips"><a class="go-chip" href="${F.JobLinks.laerepladsen}" target="_blank" rel="noopener">Lærepladsen.dk ↗</a></div>`;
  }

  $('jobs-switch').addEventListener('click', (event) => {
    const button = event.target.closest('[data-jobs-tab]');
    if (!button) return;
    jobsState.tab = button.dataset.jobsTab;
    renderJobs();
  });
  $('jobs-input').addEventListener('input', () => {
    jobsState.query = $('jobs-input').value;
    renderJobs();
  });

  // ---------------------------------------------------------------- AI chat
  const Chats = {
    guide: {
      endpoint: '/api/guide',
      accent: '#61708A',
      greeting: () => 'Hej! Jeg er din guide til uddannelser. Spørg mig om, hvad en uddannelse kræver af fag og snit, hvilken linje du skal vælge, eller hvilke fag du mangler. Fortæl mig gerne, hvad du går på nu, og hvilke fag du har.',
      suggestions: ['Hvad kræver det at blive læge?', 'Hvilken studieretning skal jeg vælge for at blive ingeniør?', 'Hvilke fag mangler jeg til psykologi?', 'Hvad er forskellen på kvote 1 og kvote 2?'],
      messages: [],
      context: null,
    },
    persona: {
      endpoint: '/api/persona',
      accent: '#B44E6B',
      greeting: (chat) => (chat.context
        ? 'Hej! Jeg har set resultatet af din personlighedstest. Lad os undersøge det sammen. Hvad tænker du om din persona, passer den på dig?'
        : 'Hej! Jeg er din AI-vejleder. Fortæl mig lidt om dig selv, fx hvad du kan lide at lave, eller hvad du er god til, så finder vi ud af, hvad der kunne passe til dig.'),
      suggestions: ['Hvem er jeg egentlig?', 'Hvilken uddannelse passer til mig?', 'Jeg kan godt lide at arbejde med hænderne', 'Jeg ved slet ikke, hvad jeg vil'],
      messages: [],
      context: null,
    },
  };
  const chatState = { active: 'guide', loading: false, error: null };

  function renderChat() {
    const chat = Chats[chatState.active];
    $('chat').style.setProperty('--accent', chat.accent);
    document.querySelectorAll('[data-chat-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.chatTab === chatState.active)));

    const bubbles = [{ role: 'assistant', content: chat.greeting(chat) }, ...chat.messages]
      .map((m) => `<div class="bubble ${m.role}">${esc(m.content)}</div>`);
    if (chat.messages.length === 0) {
      bubbles.push(`<div class="chat-suggestions">${chat.suggestions.map((s) => `<button type="button" data-suggestion="${esc(s)}">${esc(s)}</button>`).join('')}</div>`);
    }
    if (chatState.loading) bubbles.push('<div class="bubble assistant typing">Skriver …</div>');
    if (chatState.error) bubbles.push(`<p class="chat-error" role="alert">${esc(chatState.error)}</p>`);

    const log = $('chat-log');
    log.innerHTML = bubbles.join('');
    log.scrollTop = log.scrollHeight;
    $('chat-send').disabled = chatState.loading;
  }

  async function sendMessage(text) {
    const content = text.trim();
    if (!content || chatState.loading) return;
    const chat = Chats[chatState.active];
    const before = chat.messages;
    chat.messages = [...before, { role: 'user', content }];
    chatState.loading = true;
    chatState.error = null;
    renderChat();

    try {
      const { ok, data } = await bridge.post(chat.endpoint, { messages: chat.messages, context: chat.context || undefined });
      if (!ok || !data || typeof data.reply !== 'string') {
        throw new Error((data && data.error) || 'Noget gik galt. Prøv igen.');
      }
      chat.messages = [...chat.messages, { role: 'assistant', content: data.reply }];
    } catch (error) {
      chat.messages = before;
      chatState.error = error instanceof TypeError
        ? 'Kunne ikke få forbindelse. Tjek din internetforbindelse, og prøv igen.'
        : error.message;
      $('chat-input').value = content;
    } finally {
      chatState.loading = false;
      renderChat();
    }
  }

  /** Switches to a chat. A test result starts a fresh conversation about that result. */
  function openChat(which, context) {
    chatState.active = which;
    chatState.error = null;
    if (context !== undefined) {
      Chats[which].context = context;
      Chats[which].messages = [];
    }
    renderChat();
    goTo('ai');
  }

  $('chat-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-chat-tab]');
    if (!button || chatState.loading) return;
    chatState.active = button.dataset.chatTab;
    chatState.error = null;
    renderChat();
  });
  $('chat-log').addEventListener('click', (event) => {
    const button = event.target.closest('[data-suggestion]');
    if (button) sendMessage(button.dataset.suggestion);
  });
  $('chat-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('chat-input');
    const text = input.value;
    input.value = '';
    sendMessage(text);
  });
  $('chat-input').addEventListener('keydown', (event) => {
    // Enter sends, Shift+Enter makes a new line.
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $('chat-form').requestSubmit();
    }
  });

  // ---------------------------------------------------------------- Glossary
  function renderGlossary() {
    const query = $('glossary-input').value;
    const categories = F.searchGlossary(query);
    $('glossary').innerHTML = categories.length === 0
      ? `<div class="empty" style="margin-top:24px"><b>Ingen ord matcher “${esc(query.trim())}”</b><p class="muted">Prøv et andet ord.</p></div>`
      : categories.map((category) => `
        <div class="glossary-cat">
          <h3>${esc(category.title)}</h3>
          <div class="terms">${category.terms.map((t) => `
            <article class="term"><h3>${esc(t.term)}</h3>${t.aliases && t.aliases.length ? `<span class="aka">Også: ${esc(t.aliases.join(', '))}</span>` : ''}<p>${esc(t.explanation)}</p></article>`).join('')}
          </div>
        </div>`).join('');
  }
  $('glossary-input').addEventListener('input', renderGlossary);

  // ---------------------------------------------------------------- Links between sections
  document.addEventListener('click', (event) => {
    const fav = event.target.closest('[data-fav]');
    if (fav) {
      event.preventDefault();
      event.stopPropagation();
      toggleFavorite(fav.dataset.fav);
      return;
    }
    const open = event.target.closest('[data-open-direction]');
    if (open) {
      event.preventDefault();
      openDirection(open.dataset.openDirection, open.dataset.openProgram);
      return;
    }
    const levelLink = event.target.closest('a[data-level]');
    if (levelLink) {
      event.preventDefault();
      selectLevel(levelLink.dataset.level);
      goTo('udforsk');
      return;
    }
    const chatLink = event.target.closest('a[data-chat]');
    if (chatLink) {
      event.preventDefault();
      openChat(chatLink.dataset.chat);
      return;
    }
    const jobsLink = event.target.closest('[data-jobs-open]');
    if (jobsLink) {
      jobsState.tab = jobsLink.dataset.jobsOpen;
      renderJobs();
    }
  });

  // ---------------------------------------------------------------- Menu
  // Wide screens: each heading opens a small dropdown. Narrow screens: the Menu button opens
  // one panel with every heading and its sections.
  const header = document.querySelector('.site-header');
  const menuToggle = document.querySelector('.menu-toggle');
  const groups = [...document.querySelectorAll('.menu-group')];

  function closeGroups(except) {
    groups.forEach((group) => {
      if (group === except) return;
      group.classList.remove('open');
      group.querySelector('.menu-title').setAttribute('aria-expanded', 'false');
    });
  }

  function closeMenu() {
    closeGroups();
    header.classList.remove('menu-open');
    menuToggle.setAttribute('aria-expanded', 'false');
  }

  groups.forEach((group) => {
    const title = group.querySelector('.menu-title');
    title.addEventListener('click', () => {
      const open = !group.classList.contains('open');
      closeGroups(group);
      group.classList.toggle('open', open);
      title.setAttribute('aria-expanded', String(open));
    });
  });

  menuToggle.addEventListener('click', () => {
    const open = !header.classList.contains('menu-open');
    closeGroups();
    header.classList.toggle('menu-open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
  });

  // Picking a section, clicking outside or pressing Escape closes the menu.
  document.getElementById('site-menu').addEventListener('click', (event) => {
    if (event.target.closest('a')) closeMenu();
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.site-header')) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const openTitle = document.querySelector('.menu-group.open .menu-title');
    const wasOpen = openTitle || header.classList.contains('menu-open');
    closeMenu();
    if (wasOpen) (openTitle || menuToggle).focus();
  });

  // ---------------------------------------------------------------- Contact form
  // Not connected to an inbox yet, so it only checks the fields.
  const form = $('contact-form');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const status = $('form-status');
    if (!form.checkValidity()) {
      status.textContent = 'Udfyld navn, en gyldig e-mail og en besked.';
      form.querySelector(':invalid')?.focus();
      return;
    }
    status.textContent = 'Formularen er ikke koblet til en indbakke endnu, så beskeden blev ikke sendt.';
  });

  // ---------------------------------------------------------------- Start
  selectLevel(explorer.level);
  renderSearch();
  renderProfilePills();
  renderCompleteness();
  renderRecommendations();
  renderTest();
  renderJobs();
  renderChat();
  renderGlossary();
  renderFavorites();
})();
