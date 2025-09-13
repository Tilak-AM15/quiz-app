
        // ---------- helpers ----------
        const $ = sel => document.querySelector(sel);
        const subjectSel = $('#subject');
        const diffSel = $('#difficulty');
        const qCountInput = $('#qcount');
        const startBtn = $('#startBtn');
        const stopBtn = $('#stopBtn');
        const msg = $('#msg');
        const quizCard = $('#quizCard');
        const qprog = $('#qprog');
        const qscore = $('#qscore');
        const questionEl = $('#question');
        const answersEl = $('#answers');
        const nextBtn = $('#nextBtn');
        const stopMidBtn = $('#stopMidBtn');
        const errEl = $('#err');
        const resultCard = $('#resultCard');
        const resultTitle = $('#resultTitle');
        const resultText = $('#resultText');
        const againBtn = $('#againBtn');
        const retryBtn = $('#retryBtn');
        const hintBtn = $('#hintBtn');
        const timerToggleBtn = $('#timerToggleBtn');
        const timerDisplay = $('#timerDisplay');
        const reviewBox = document.getElementById('reviewBox');
        const progressBar = document.getElementById('progressBar');
        const progressLabel = document.getElementById('progressLabel');
        const progressBarContainer = document.getElementById('progressBarContainer');

        let QUESTIONS = [];
        let idx = 0, score = 0, answeredCount = 0;
        let lastSettings = null;

        let timer = null;
        let timerPaused = false;
        let timePerQ = 20; // seconds per question
        let secondsLeft = timePerQ;
        let hintUsed = false;

        // --------- subject loading: combine all categories, no group by API ---------
        async function loadSubjects() {
            subjectSel.innerHTML = '<option value="" selected disabled>Select Subject</option>';
            subjectSel.disabled = true;
            msg.textContent = 'Loading subject lists…';
            msg.classList.add('loading');

            let allSubjects = [];

            // Trivia API
            try {
                const res = await fetchWithTimeout('https://the-trivia-api.com/v2/categories', 12000);
                const data = await res.json();
                Object.keys(data).forEach(name => {
                    allSubjects.push({
                        value: `trivia:${toSlugForTrivia(name)}`,
                        text: name
                    });
                });
            } catch (e) {
                console.warn('Trivia categories failed', e);
            }

            // OpenTDB categories
            try {
                const res = await fetchWithTimeout('https://opentdb.com/api_category.php', 12000);
                const data = await res.json();
                data.trivia_categories.forEach(cat => {
                    allSubjects.push({
                        value: `open:${cat.id}`,
                        text: cat.name
                    });
                });
            } catch (e) {
                console.warn('OpenTDB categories failed', e);
            }

            // Sort alphabetically, remove duplicates by text
            allSubjects = allSubjects.filter((s, i, arr) =>
                arr.findIndex(ss => ss.text.toLowerCase() === s.text.toLowerCase()) === i
            );
            allSubjects.sort((a, b) => a.text.localeCompare(b.text));

            subjectSel.innerHTML = '';
            // Add the 'Select Subject' placeholder option at the top
            const placeholderOption = document.createElement('option');
            placeholderOption.value = '';
            placeholderOption.textContent = 'Select Subject';
            placeholderOption.disabled = true;
            placeholderOption.selected = true;
            subjectSel.appendChild(placeholderOption);

            if (allSubjects.length === 0) {
                subjectSel.innerHTML = `<option value="" disabled selected>Failed to load subjects</option>`;
                msg.textContent = '⚠️ Unable to load subjects from APIs.';
                subjectSel.disabled = true;
            } else {
                allSubjects.forEach(s => {
                    const o = document.createElement('option');
                    o.value = s.value;
                    o.textContent = s.text;
                    subjectSel.appendChild(o);
                });
                subjectSel.disabled = false;
                // Do not auto-select any subject!
                msg.textContent = 'Subjects loaded. Pick one and start!';
                msg.classList.remove('loading');
                subjectSel.focus();
            }
        }

        function decodeHTML(html) {
            const t = document.createElement('textarea');
            t.innerHTML = html;
            return t.value;
        }
        function shuffle(arr) {
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        }
        function fetchWithTimeout(url, ms = 1000) {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), ms);
            return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
        }
        function toSlugForTrivia(cat) {
            return cat.toLowerCase()
                .replace(/&/g, 'and')
                .replace(/\//g, '_')
                .replace(/[^a-z0-9 _-]/g, '')
                .replace(/\s+/g, '_');
        }
        async function getTriviaQuestions({ categorySlug, limit, difficulty }) {
            let url = `https://the-trivia-api.com/v2/questions?limit=${limit}`;
            if (categorySlug) url += `&categories=${categorySlug}`;
            if (difficulty) url += `&difficulties=${difficulty}`;
            const res = await fetchWithTimeout(url, 12000);
            const arr = await res.json();
            return arr.map(q => ({
                question: q.question.text,
                answers: shuffle([q.correctAnswer, ...q.incorrectAnswers]),
                correct: q.correctAnswer,
                correctExplanation: q.explanation || "",
                difficulty: q.difficulty || "",
                category: q.category || "",
            }));
        }
        async function getOpenTDBQuestions({ categoryId, amount, difficulty }) {
            let url = `https://opentdb.com/api.php?type=multiple&amount=${amount}`;
            if (categoryId) url += `&category=${categoryId}`;
            if (difficulty) url += `&difficulty=${difficulty}`;
            const res = await fetchWithTimeout(url, 12000);
            const data = await res.json();
            return (data.results || []).map(q => ({
                question: decodeHTML(q.question),
                answers: shuffle([decodeHTML(q.correct_answer), ...q.incorrect_answers.map(decodeHTML)]),
                correct: decodeHTML(q.correct_answer),
                correctExplanation: "",
                difficulty: q.difficulty || "",
                category: q.category || "",
            }));
        }

        // ---------- quiz flow ----------
        function showQuizUI() {
            quizCard.classList.remove('hidden');
            resultCard.classList.add('hidden');
            stopBtn.classList.remove('hidden');
            renderQ();
            updateMeta();
            updateProgressBar();
        }
        function hideQuizUI() {
            quizCard.classList.add('hidden');
            stopBtn.classList.add('hidden');
        }
        function updateMeta() {
            qprog.textContent = `Question ${Math.min(idx + 1, QUESTIONS.length)}/${QUESTIONS.length}`;
            qscore.textContent = `Score: ${score}`;
            qscore.classList.remove('score-bounce');
            void qscore.offsetWidth;
            qscore.classList.add('score-bounce');
            updateProgressBar();
        }
        function renderQ() {
            const q = QUESTIONS[idx];
            if (!q) return;
            answersEl.classList.add('slide-out');

            setTimeout(() => {
                answersEl.classList.remove('slide-out');
                questionEl.innerHTML = q.question;
                answersEl.innerHTML = '';
                hintBtn.disabled = false;
                hintUsed = false;

                q.answers.forEach(a => {
                    const btn = document.createElement('button');
                    btn.className = 'opt';
                    btn.textContent = a;
                    btn.onclick = () => {
                        if (q.answered) return;
                        q.answered = true;
                        if (a === q.correct) {
                            btn.classList.add('correct');
                            score++;
                        } else {
                            btn.classList.add('wrong');
                            [...answersEl.children].forEach(b => {
                                if (b.textContent === q.correct) b.classList.add('correct');
                            });
                        }
                        [...answersEl.children].forEach(b => b.disabled = true);
                        answeredCount++;
                        if (hintUsed) q.usedHint = true;
                        q.userAnswer = a;
                        stopTimer();
                        updateMeta();
                    };
                    answersEl.appendChild(btn);
                });
                nextBtn.disabled = false;
                resetTimer();
                updateProgressBar();
            }, 250);
        }

        function endQuiz(reason = 'completed') {
            hideQuizUI();
            resultCard.classList.remove('hidden');
            const attempted = answeredCount;
            const total = QUESTIONS.length;
            const title = reason === 'stopped' ? '⏹️ Quiz Stopped' : '✅ Quiz Completed';
            resultTitle.textContent = title;

            const pct = attempted ? Math.round((score / attempted) * 100) : 0;
            let usedHints = QUESTIONS.filter(q => q.usedHint).length;
            let hintLine = usedHints ? `<div><strong>Hints used:</strong> ${usedHints}</div>` : "";
            resultText.innerHTML = `
        <div><strong>Score:</strong> ${score}</div>
        <div><strong>Attempted:</strong> ${attempted} / ${total}</div>
        <div><strong>Accuracy:</strong> ${pct}%</div>
        ${hintLine}
    `;
            renderReview();
            stopTimer();
        }
        function renderReview() {
            let html = '<h3 style="margin-bottom:10px">Review:</h3>';
            html += '<ol style="padding-left:18px;">';
            QUESTIONS.forEach((q, i) => {
                let isCorrect = q.userAnswer && q.userAnswer === q.correct;
                html += `<li style="margin-bottom:10px">
            <div><b>Q:</b> ${q.question}</div>
            <div>
                <span style="color:${isCorrect ? 'green' : '#e17055'}"><b>Your answer:</b> ${q.userAnswer ? q.userAnswer : '<em>Not answered</em>'}</span>
                <span style="color:var(--secondary);margin-left:10px;"><b>Correct:</b> ${q.correct}</span>
                ${q.usedHint ? '<span class="pill" style="margin-left:10px;">Hint used</span>' : ''}
            </div>
        </li>`;
            });
            html += '</ol>';
            reviewBox.innerHTML = html;
        }

        // ---------- Progress Bar ----------
        function updateProgressBar() {
            if (!QUESTIONS.length) {
                progressBar.style.width = "0%";
                progressLabel.textContent = "";
                return;
            }
            let current = idx + 1;
            let total = QUESTIONS.length;
            let percent = Math.min(100, Math.round((current / total) * 100));
            progressBar.style.width = percent + "%";
            progressLabel.textContent = `Progress: ${current} / ${total}`;
        }

        // ---------- Timer feature ----------
        function resetTimer() {
            stopTimer();
            secondsLeft = timePerQ;
            updateTimerDisplay();
            timerPaused = false;
            timerToggleBtn.textContent = "Pause Timer";
            timer = setInterval(() => {
                if (!timerPaused) {
                    secondsLeft--;
                    updateTimerDisplay();
                    if (secondsLeft <= 0) {
                        stopTimer();
                        autoMoveNext();
                    }
                }
            }, 1000);
        }
        function updateTimerDisplay() {
            timerDisplay.textContent = `⏱️ ${secondsLeft}s`;
            if (secondsLeft <= 5) timerDisplay.style.background = "#ffcccc";
            else timerDisplay.style.background = "";
        }
        function stopTimer() {
            if (timer) clearInterval(timer);
            timer = null;
        }
        function autoMoveNext() {
            const q = QUESTIONS[idx];
            if (q.answered) return;
            q.answered = true;
            q.userAnswer = null;
            [...answersEl.children].forEach(b => {
                if (b.textContent === q.correct) b.classList.add('correct');
                b.disabled = true;
            });
            updateMeta();
            setTimeout(() => {
                if (idx < QUESTIONS.length - 1) {
                    idx++;
                    renderQ();
                    updateMeta();
                } else {
                    endQuiz('completed');
                }
            }, 1500);
        }

        // ---------- Hint feature (eliminate one wrong answer) ----------
        hintBtn.onclick = () => {
            if (hintUsed) return;
            const q = QUESTIONS[idx];
            if (!q) return;
            let wrongBtns = [...answersEl.children].filter(b => b.textContent !== q.correct && !b.disabled);
            if (wrongBtns.length > 0) {
                const toHide = wrongBtns[Math.floor(Math.random() * wrongBtns.length)];
                toHide.style.visibility = "hidden";
                hintBtn.disabled = true;
                hintUsed = true;
            }
        };

        // ---------- Buttons ----------
        startBtn.onclick = async () => {
            const subject = subjectSel.value;
            const difficulty = diffSel.value;
            const count = Math.max(5, Math.min(30, +qCountInput.value || 10));
            lastSettings = { subject, difficulty, count };
            QUESTIONS = []; idx = 0; score = 0; answeredCount = 0;
            msg.textContent = 'Fetching questions…';
            msg.classList.add('loading');
            errEl.classList.add('hidden');
            reviewBox.innerHTML = "";
            updateProgressBar();

            // Enforce subject selection
            if (!subject) {
                alert("Please select a subject before starting the quiz.");
                msg.textContent = "⚠️ Please select a subject before starting the quiz.";
                msg.classList.remove('loading');
                return;
            }

            try {
                if (subject === 'mix:random') {
                    const share = Math.max(2, Math.floor(count / 2));
                    const leftovers = count - share;
                    const tasks = [
                        getTriviaQuestions({ categorySlug: '', limit: share, difficulty: difficulty || '' }).catch(() => []),
                        getOpenTDBQuestions({ categoryId: '', amount: leftovers, difficulty: difficulty || '' }).catch(() => [])
                    ];
                    const chunks = await Promise.all(tasks);
                    QUESTIONS = shuffle(chunks.flat()).slice(0, count);
                    if (QUESTIONS.length < count) {
                        const topup1 = await getTriviaQuestions({ categorySlug: '', limit: count, difficulty: difficulty || '' }).catch(() => []);
                        const topup2 = await getOpenTDBQuestions({ categoryId: '', amount: count, difficulty: difficulty || '' }).catch(() => []);
                        QUESTIONS = shuffle([...QUESTIONS, ...topup1, ...topup2]).slice(0, count);
                    }
                } else if (subject.startsWith('trivia:')) {
                    const slug = subject.split(':')[1];
                    QUESTIONS = await getTriviaQuestions({ categorySlug: slug, limit: count, difficulty });
                } else if (subject.startsWith('open:')) {
                    const id = subject.split(':')[1];
                    QUESTIONS = await getOpenTDBQuestions({ categoryId: id, amount: count, difficulty });
                }
                QUESTIONS.forEach(q => { q.userAnswer = null; q.usedHint = false; });
                if (!QUESTIONS.length) throw new Error('No questions available from APIs.');
                msg.textContent = 'Good luck! 👇';
                msg.classList.remove('loading');
                showQuizUI();
            } catch (e) {
                console.error(e);
                msg.textContent = '⚠️ Could not load questions. Please try a different subject.';
                errEl.textContent = e.message || 'Unknown error';
                errEl.classList.remove('hidden');
            }
        };
        nextBtn.onclick = () => {
            if (idx < QUESTIONS.length - 1) {
                idx++;
                renderQ();
                updateMeta();
            } else {
                endQuiz('completed');
            }
        };
        stopBtn.onclick = () => endQuiz('stopped');
        stopMidBtn.onclick = () => endQuiz('stopped');
        againBtn.onclick = () => {
            resultCard.classList.add('hidden');
            msg.textContent = 'Pick a subject and start!';
            subjectSel.focus();
        };
        retryBtn.onclick = () => {
            if (!lastSettings) return;
            subjectSel.value = lastSettings.subject;
            diffSel.value = lastSettings.difficulty;
            qCountInput.value = lastSettings.count;
            startBtn.click();
        };
        // Timer controls
        timerToggleBtn.onclick = () => {
            timerPaused = !timerPaused;
            timerToggleBtn.textContent = timerPaused ? "Resume Timer" : "Pause Timer";
        };
        loadSubjects();
        // Toggle dark/light mode
        const themeToggle = document.getElementById("themeToggle");
        themeToggle.addEventListener("click", () => {
            document.body.classList.toggle("dark");
        });
