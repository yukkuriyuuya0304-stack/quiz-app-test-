import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, setDoc, getDoc, updateDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCLRWTz8HCrG4x41f4V-4S9_H8GKGOC-os",
    authDomain: "quiz-app-base-2test.firebaseapp.com",
    projectId: "quiz-app-base-2test",
    storageBucket: "quiz-app-base-2test.firebasestorage.app",
    messagingSenderId: "232545397427",
    appId: "1:232545397427:web:e75b2650481a6ea0899ec6",
    measurementId: "G-PRHYDR5WP0"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 👤 端末固有のユーザーID管理（作成者判定用）
let myUserId = localStorage.getItem("quiz_creator_user_id");
if (!myUserId) {
    myUserId = 'user_' + Math.random().toString(36).substr(2, 9) + Date.now();
    localStorage.setItem("quiz_creator_user_id", myUserId);
}

const FIXED_TAGS = [
    "歴史", "地理", "理科・科学", "国語・文学", "数学・計算",
    "アニメ・漫画", "ゲーム", "芸能・エンタメ", "スポーツ", "雑学・その他"
];

let allQuizData = [
    { question: "日本の首都はどこでしょう？", options: ["東京", "大阪", "京都", "福岡"], answer: "東京", difficulty: "beginner", genres: ["地理", "雑学・その他"], packName: "デフォルト", creatorId: "default" },
    { question: "太陽系で最も大きい惑星はどれでしょう？", options: ["木星", "地球", "火星", "土星"], answer: "木星", difficulty: "beginner", genres: ["理科・科学"], packName: "デフォルト", creatorId: "default" }
];

async function loadCloudQuestions() {
    try {
        const querySnapshot = await getDocs(collection(db, "questions"));
        querySnapshot.forEach((doc) => {
            const q = doc.data();
            if (!allQuizData.some(existing => existing.question === q.question)) {
                allQuizData.push(q);
            }
        });
        console.log("クラウドから問題を読み込みました！総問題数:", allQuizData.length);
        updateReviewButtonState();
        populateLobbyGenreOptions();
        checkMyPacksExistence(); // 本人用パックボタンの表示制御
    } catch (error) {
        console.error("問題の読み込みエラー:", error);
    }
}

// ゲーム管理変数
let activeQuizData = []; 
let wrongQuestions = []; 
let scoreHistory = [];
let currentMode = '';    
let currentQuestionIndex = 0;
let score = 0;
let textInterval;
let answerTimer; 
const MAX_TIME_MS = 6000; 
let timeLeftMs = MAX_TIME_MS;
let currentCharIndex = 0;
let isBuzzed = false;
let isLastAnswerCorrect = false;
let selectedGenre = ''; 
let selectedPack = '';
let selectedTags = [];

// オンライン変数
let currentRoomId = null;
let myPlayerName = "";
let unsubscribeRoom = null;
let isHost = false;
let isOnlineMode = false;
let currentBuzzerPlayer = null;
let autoNextTimer = null;
let nextCountdownInterval = null;
let roomDataCache = null;

// DOM要素
const startScreen = document.getElementById("start-screen");
const genreScreen = document.getElementById("genre-screen");
const packScreen = document.getElementById("pack-screen");
const createScreen = document.getElementById("create-screen");
const quizScreen = document.getElementById("quiz-screen");
const resultScreen = document.getElementById("result-screen");
const lobbyScreen = document.getElementById("lobby-screen");
const roomKeyDisplay = document.getElementById("room-key-display");
const playersListEl = document.getElementById("players-list");
const startRoomMatchBtn = document.getElementById("start-room-match-btn");
const playerNameInput = document.getElementById("player-name");
const genreButtonsContainer = document.getElementById("genre-buttons-container");
const packButtonsContainer = document.getElementById("pack-buttons-container");
const modeReviewBtn = document.getElementById("mode-review");
const btnToPack = document.getElementById("btn-to-pack");
const modeLabelEl = document.getElementById("mode-label");
const questionNumberEl = document.getElementById("question-number");
const questionTextEl = document.getElementById("question-text");
const buzzerBtn = document.getElementById("buzzer-btn");
const optionsContainer = document.getElementById("options-container");
const resultMessageEl = document.getElementById("result-message");
const nextBtn = document.getElementById("next-btn");
const timerText = document.getElementById("timer-text");
const timerBarContainer = document.getElementById("timer-bar-container");
const timerBar = document.getElementById("timer-bar");
const difficultySelect = document.getElementById("difficulty-select");
const historyListEl = document.getElementById("score-history-list");
const nextCountdownText = document.getElementById("next-countdown-text");
const onlineScoreboard = document.getElementById("online-scoreboard");
const showRuleBtn = document.getElementById("show-rule-btn");
const ruleModal = document.getElementById("rule-modal");
const ruleModalBody = document.getElementById("rule-modal-body");
const helpModal = document.getElementById("help-modal");

// ロビー設定要素
const lobbyWinCondition = document.getElementById("lobby-win-condition");
const lobbyDifficulty = document.getElementById("lobby-difficulty");
const lobbyGenre = document.getElementById("lobby-genre");
const lobbyPenalty = document.getElementById("lobby-penalty");
const guestRuleNotice = document.getElementById("guest-rule-notice");

// --- データ読込 ---
async function loadData() {
    const savedWrong = localStorage.getItem("wrongQuestions");
    if (savedWrong) wrongQuestions = JSON.parse(savedWrong);
    const savedHistory = localStorage.getItem("quizHistory");
    if (savedHistory) scoreHistory = JSON.parse(savedHistory);
    const savedName = localStorage.getItem("quizPlayerName");
    if (savedName && playerNameInput) playerNameInput.value = savedName;

    updateReviewButtonState();
    renderHistory();
    await loadCloudQuestions();
    updateKeyboardFocus();
}

function saveWrongQuestions() {
    localStorage.setItem("wrongQuestions", JSON.stringify(wrongQuestions));
    updateReviewButtonState();
}

function saveHistory(mode, diff, finalScore, total) {
    const date = new Date().toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    let modeName = mode === 'normal' ? '通常' : mode === 'suddendeath' ? 'サドンデス' : mode === 'genre' ? `ジャンル(${selectedGenre})` : mode === 'pack' ? `パック(${selectedPack})` : mode === 'online' ? 'オンライン対戦' : '復習';
    const diffName = diff === 'all' ? 'すべて' : diff === 'beginner' ? '初級' : '上級';
    scoreHistory.unshift({ date, modeName, diffName, score: finalScore, total });
    if (scoreHistory.length > 10) scoreHistory.pop();
    localStorage.setItem("quizHistory", JSON.stringify(scoreHistory));
    renderHistory();
}

function renderHistory() {
    historyListEl.innerHTML = "";
    if (scoreHistory.length === 0) {
        historyListEl.innerHTML = "<li>記録はありません</li>";
        return;
    }
    scoreHistory.forEach(h => {
        const li = document.createElement("li");
        li.textContent = `${h.date} - ${h.modeName}(${h.diffName}) : ${h.score}/${h.total}問`;
        historyListEl.appendChild(li);
    });
}
window.addEventListener("DOMContentLoaded", loadData);

// 本人が作成したパックが存在するか確認
function checkMyPacksExistence() {
    const myPacks = [...new Set(allQuizData.filter(q => q.creatorId === myUserId && q.packName).map(q => q.packName))];
    if (myPacks.length > 0) {
        btnToPack.classList.remove("hidden");
    } else {
        btnToPack.classList.add("hidden");
    }
    updateKeyboardFocus();
}

// モーダル制御
document.getElementById("show-help-btn").addEventListener("click", () => helpModal.classList.remove("hidden"));
document.getElementById("close-help-modal-btn").addEventListener("click", () => helpModal.classList.add("hidden"));

// --- 問題作成 ---
document.getElementById("btn-to-create").addEventListener("click", () => {
    selectedTags = [];
    renderFixedTagButtons();
    startScreen.classList.add("hidden");
    createScreen.classList.remove("hidden");
    updateKeyboardFocus();
});

function renderFixedTagButtons() {
    const container = document.getElementById("tag-select-container");
    container.innerHTML = "";
    FIXED_TAGS.forEach(tag => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = tag;
        btn.className = "tag-btn";
        if (selectedTags.includes(tag)) btn.classList.add("selected");
        btn.addEventListener("click", () => {
            if (selectedTags.includes(tag)) selectedTags = selectedTags.filter(t => t !== tag);
            else selectedTags.push(tag);
            renderFixedTagButtons();
        });
        container.appendChild(btn);
    });
}

document.getElementById("cancel-create-btn").addEventListener("click", () => {
    createScreen.classList.add("hidden");
    startScreen.classList.remove("hidden");
    updateKeyboardFocus();
});

document.getElementById("submit-question-btn").addEventListener("click", async () => {
    const qText = document.getElementById("create-q").value.trim();
    const ans = document.getElementById("create-ans").value.trim();
    const d1 = document.getElementById("create-d1").value.trim();
    const d2 = document.getElementById("create-d2").value.trim();
    const d3 = document.getElementById("create-d3").value.trim();
    const diff = document.getElementById("create-diff").value;
    const pack = document.getElementById("create-pack").value.trim() || "デフォルト";

    if (!qText || !ans || !d1 || !d2 || !d3) return alert("すべての項目を入力してください！");
    if (selectedTags.length === 0) return alert("ジャンルタグを少なくとも1つ選択してください！");

    const newQuestion = {
        question: qText,
        options: [ans, d1, d2, d3],
        answer: ans,
        difficulty: diff,
        genres: selectedTags,
        packName: pack,
        creatorId: myUserId // 作成者IDを付与
    };

    try {
        await addDoc(collection(db, "questions"), newQuestion);
        allQuizData.push(newQuestion);
        alert(`データベースに公開しました！${pack !== "デフォルト" ? `(パック: ${pack})` : ''}`);
        
        document.getElementById("create-q").value = "";
        document.getElementById("create-ans").value = "";
        document.getElementById("create-d1").value = "";
        document.getElementById("create-d2").value = "";
        document.getElementById("create-d3").value = "";
        document.getElementById("create-pack").value = "";
        
        createScreen.classList.add("hidden");
        startScreen.classList.remove("hidden");
        populateLobbyGenreOptions();
        checkMyPacksExistence();
    } catch (error) {
        console.error("保存エラー:", error);
        alert("保存に失敗しました。");
    }
});

// --- パック選択画面（本人のみ） ---
btnToPack.addEventListener("click", () => {
    const myPacks = [...new Set(allQuizData.filter(q => q.creatorId === myUserId && q.packName).map(q => q.packName))];
    packButtonsContainer.innerHTML = "";

    if (myPacks.length === 0) {
        packButtonsContainer.innerHTML = "<p>作成したカテゴリはまだありません。</p>";
    } else {
        myPacks.forEach(pack => {
            const btn = document.createElement("button");
            btn.textContent = pack;
            btn.className = "mode-btn nav-item";
            btn.style.backgroundColor = "#5856d6";
            btn.addEventListener("click", () => {
                selectedPack = pack;
                initMode('pack');
            });
            packButtonsContainer.appendChild(btn);
        });
    }

    startScreen.classList.add("hidden");
    packScreen.classList.remove("hidden");
    updateKeyboardFocus();
});

document.getElementById("back-from-pack-btn").addEventListener("click", () => {
    packScreen.classList.add("hidden");
    startScreen.classList.remove("hidden");
    updateKeyboardFocus();
});

// --- シングルプレイ ゲームロジック ---
function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

function filterByDifficulty(questions, customDiff) {
    const selectedDifficulty = customDiff || difficultySelect.value;
    if (selectedDifficulty === "all") return questions;
    return questions.filter(q => q.difficulty === selectedDifficulty);
}

function updateReviewButtonState() {
    const filteredWrong = filterByDifficulty(wrongQuestions);
    if (filteredWrong.length > 0) {
        modeReviewBtn.disabled = false;
        modeReviewBtn.querySelector("small").textContent = `該当問題: ${filteredWrong.length}問`;
    } else {
        modeReviewBtn.disabled = true;
        modeReviewBtn.querySelector("small").textContent = `該当問題なし`;
    }
}
difficultySelect.addEventListener("change", updateReviewButtonState);

document.getElementById("btn-to-genre").addEventListener("click", () => {
    const diffFiltered = filterByDifficulty(allQuizData);
    genreButtonsContainer.innerHTML = "";
    
    FIXED_TAGS.forEach(genre => {
        const btn = document.createElement("button");
        btn.textContent = genre;
        btn.className = "mode-btn nav-item";
        const hasQuestions = diffFiltered.some(q => (q.genres && q.genres.includes(genre)) || q.genre === genre);
        
        if (hasQuestions) {
            btn.style.backgroundColor = "#007aff";
            btn.addEventListener("click", () => {
                selectedGenre = genre;
                initMode('genre');
            });
        } else {
            btn.style.backgroundColor = "#ccc";
            btn.style.cursor = "not-allowed";
            btn.addEventListener("click", () => alert(`「${genre}」の問題はまだありません！`));
        }
        genreButtonsContainer.appendChild(btn);
    });
    
    startScreen.classList.add("hidden");
    genreScreen.classList.remove("hidden");
    updateKeyboardFocus();
});

document.getElementById("back-to-start-btn").addEventListener("click", () => {
    genreScreen.classList.add("hidden");
    startScreen.classList.remove("hidden");
    updateKeyboardFocus();
});

function initMode(mode) {
    isOnlineMode = false;
    currentMode = mode;
    currentQuestionIndex = 0;
    score = 0;
    
    let sourceData = mode === 'review' ? wrongQuestions 
        : mode === 'genre' ? allQuizData.filter(q => (q.genres && q.genres.includes(selectedGenre)) || q.genre === selectedGenre)
        : mode === 'pack' ? allQuizData.filter(q => q.packName === selectedPack && q.creatorId === myUserId)
        : allQuizData;

    activeQuizData = filterByDifficulty(sourceData);
    if (activeQuizData.length === 0) return alert("該当する問題がありません！");
    activeQuizData = shuffleArray(activeQuizData);
    
    const diffText = difficultySelect.options[difficultySelect.selectedIndex].text;
    let modeText = mode === 'normal' ? '通常' : mode === 'suddendeath' ? 'サドンデス' : mode === 'genre' ? `【${selectedGenre}】` : mode === 'pack' ? `【パック:${selectedPack}】` : '復習';
    
    modeLabelEl.textContent = `${modeText} / ${diffText}`;
    onlineScoreboard.classList.add("hidden");
    showRuleBtn.classList.add("hidden");
    
    startScreen.classList.add("hidden");
    genreScreen.classList.add("hidden");
    packScreen.classList.add("hidden");
    quizScreen.classList.remove("hidden");
    startQuestion();
}

document.getElementById("mode-normal").addEventListener("click", () => initMode('normal'));
document.getElementById("mode-suddendeath").addEventListener("click", () => initMode('suddendeath'));
modeReviewBtn.addEventListener("click", () => initMode('review'));

// 問題の開始
function startQuestion(fromIndex = 0) {
    isBuzzed = false;
    currentBuzzerPlayer = null;
    currentCharIndex = fromIndex;
    
    if (fromIndex === 0) {
        questionTextEl.textContent = "";
    }
    
    optionsContainer.innerHTML = "";
    optionsContainer.classList.add("hidden");
    resultMessageEl.textContent = "";
    nextBtn.classList.add("hidden");
    timerText.classList.add("hidden");
    timerBarContainer.classList.add("hidden");
    timerBar.style.width = "100%";
    timerBar.classList.remove("timer-warning");
    nextCountdownText.classList.add("hidden");
    
    if (isOnlineMode && roomDataCache && roomDataCache.answeredPlayers && roomDataCache.answeredPlayers.includes(myPlayerName)) {
        buzzerBtn.disabled = true;
    } else {
        buzzerBtn.disabled = false;
    }
    
    clearInterval(textInterval);
    clearInterval(answerTimer);
    clearInterval(nextCountdownInterval);
    clearTimeout(autoNextTimer);
    
    const currentQuestion = activeQuizData[currentQuestionIndex];
    questionNumberEl.textContent = `問題 ${currentQuestionIndex + 1} / ${activeQuizData.length}`;

    textInterval = setInterval(() => {
        questionTextEl.textContent = currentQuestion.question.substring(0, currentCharIndex + 1);
        currentCharIndex++;
        if (currentCharIndex >= currentQuestion.question.length) {
            clearInterval(textInterval);
            startNoBuzzerTimer(); 
        }
    }, 100);
    
    updateKeyboardFocus();
}

function startNoBuzzerTimer() {
    startTimer(3000, () => handleTimeOut());
}

document.getElementById("quit-btn").addEventListener("click", () => {
    if (confirm("クイズを中断してトップに戻りますか？")) {
        clearInterval(textInterval);
        clearInterval(answerTimer);
        clearInterval(nextCountdownInterval);
        clearTimeout(autoNextTimer);
        if (isOnlineMode && unsubscribeRoom) unsubscribeRoom();
        quizScreen.classList.add("hidden");
        startScreen.classList.remove("hidden");
        updateReviewButtonState();
        updateKeyboardFocus();
    }
});

function showOptions() {
    const currentQuestion = activeQuizData[currentQuestionIndex];
    optionsContainer.innerHTML = "";
    const shuffledOptions = shuffleArray(currentQuestion.options);
    shuffledOptions.forEach((option, index) => {
        const btn = document.createElement("button");
        btn.textContent = `${index + 1}. ${option}`;
        btn.className = "option-btn nav-item";
        btn.addEventListener("click", () => checkAnswer(option));
        optionsContainer.appendChild(btn);
    });
    optionsContainer.classList.remove("hidden");
    startTimer(MAX_TIME_MS, () => handleTimeOut()); 
    updateKeyboardFocus(0); // 1番目の選択肢にフォーカス
}

function startTimer(durationMs, onTimeOut) {
    clearInterval(answerTimer);
    timeLeftMs = durationMs;
    timerText.classList.remove("hidden");
    timerBarContainer.classList.remove("hidden");
    
    answerTimer = setInterval(() => {
        timeLeftMs -= 50;
        const percentage = Math.max(0, (timeLeftMs / durationMs) * 100);
        timerBar.style.width = `${percentage}%`;
        timerText.textContent = `残り: ${(timeLeftMs / 1000).toFixed(1)}秒`;
        
        if (timeLeftMs <= 2000) {
            timerBar.classList.add("timer-warning");
            timerText.style.color = "#ff3b30";
        } else {
            timerText.style.color = "#333";
        }
        
        if (timeLeftMs <= 0) {
            clearInterval(answerTimer);
            timerBar.style.width = "0%";
            timerText.textContent = `残り: 0.0秒`;
            if (onTimeOut) onTimeOut();
        }
    }, 50);
}

// 早押しボタン押下時
buzzerBtn.addEventListener("click", async () => {
    if (isBuzzed) return;
    isBuzzed = true;
    buzzerBtn.disabled = true;
    clearInterval(textInterval);
    clearInterval(answerTimer);

    if (isOnlineMode) {
        if (currentRoomId) {
            try {
                const roomRef = doc(db, "rooms", currentRoomId);
                await updateDoc(roomRef, {
                    buzzerPlayer: myPlayerName,
                    buzzerTime: serverTimestamp(),
                    buzzIndex: currentCharIndex
                });
            } catch (err) {
                console.error("早押し送信エラー:", err);
                isBuzzed = false;
                buzzerBtn.disabled = false;
            }
        }
    } else {
        showOptions(); 
    }
});

function handleTimeOut() {
    clearInterval(textInterval);
    clearInterval(answerTimer);
    buzzerBtn.disabled = true;

    const currentQuestion = activeQuizData[currentQuestionIndex];
    Array.from(optionsContainer.children).forEach(btn => btn.disabled = true);

    if (!isOnlineMode) {
        resultMessageEl.textContent = `⏰ 時間切れ！ (正解: ${currentQuestion.answer})`;
        resultMessageEl.style.color = "#ff3b30";
        isLastAnswerCorrect = false;
        recordWrongQuestion(currentQuestion);
        startNextCountdown(3, () => {
            if (currentMode === 'suddendeath' && !isLastAnswerCorrect) return showResult(true);
            currentQuestionIndex++;
            if (currentQuestionIndex < activeQuizData.length) startQuestion();
            else showResult(false);
        });
    } else {
        if (currentBuzzerPlayer === myPlayerName) {
            const roomRef = doc(db, "rooms", currentRoomId);
            getDoc(roomRef).then(roomSnap => {
                const data = roomSnap.data();
                const answered = data.answeredPlayers || [];
                if (!answered.includes(myPlayerName)) answered.push(myPlayerName);

                let currentScore = data.scores[myPlayerName] || 0;
                if (data.settings?.penalty === "minus1") {
                    currentScore = Math.max(0, currentScore - 1);
                }

                updateDoc(roomRef, {
                    lastAnswerResult: {
                        player: myPlayerName,
                        isCorrect: false,
                        answer: "無回答(時間切れ)",
                        correctAnswer: currentQuestion.answer
                    },
                    [`scores.${myPlayerName}`]: currentScore,
                    answeredPlayers: answered,
                    allWrongOrPassed: answered.length >= data.players.length
                });
            });
        } else if (isHost && !currentBuzzerPlayer) {
            const roomRef = doc(db, "rooms", currentRoomId);
            updateDoc(roomRef, {
                lastAnswerResult: {
                    player: "全員",
                    isCorrect: false,
                    answer: "無回答",
                    correctAnswer: currentQuestion.answer
                },
                allWrongOrPassed: true
            });
        }
    }
}

async function checkAnswer(selectedOption) {
    clearInterval(answerTimer); 
    const currentQuestion = activeQuizData[currentQuestionIndex];
    Array.from(optionsContainer.children).forEach(btn => btn.disabled = true);
    
    const isCorrect = selectedOption === currentQuestion.answer;
    
    if (isOnlineMode) {
        try {
            const roomRef = doc(db, "rooms", currentRoomId);
            const roomSnap = await getDoc(roomRef);
            const data = roomSnap.data();
            let currentScore = data.scores[myPlayerName] || 0;
            const answered = data.answeredPlayers || [];
            
            if (!answered.includes(myPlayerName)) answered.push(myPlayerName);
            
            let updateData = {
                lastAnswerResult: {
                    player: myPlayerName,
                    isCorrect: isCorrect,
                    answer: selectedOption,
                    correctAnswer: currentQuestion.answer
                },
                answeredPlayers: answered
            };

            if (isCorrect) {
                updateData[`scores.${myPlayerName}`] = currentScore + 1;
            } else {
                if (data.settings?.penalty === "minus1") {
                    updateData[`scores.${myPlayerName}`] = Math.max(0, currentScore - 1);
                }
                if (answered.length >= data.players.length) {
                    updateData.allWrongOrPassed = true;
                }
            }

            await updateDoc(roomRef, updateData);
        } catch (err) {
            console.error("解答送信エラー:", err);
        }
    } else {
        if (isCorrect) {
            resultMessageEl.textContent = "⭕ 正解！";
            resultMessageEl.style.color = "#34c759";
            score++;
            isLastAnswerCorrect = true;
            if (currentMode === 'review') {
                wrongQuestions = wrongQuestions.filter(q => q.question !== currentQuestion.question);
                saveWrongQuestions();
            }
        } else {
            resultMessageEl.textContent = `❌ 不正解... (正解: ${currentQuestion.answer})`;
            resultMessageEl.style.color = "#ff3b30";
            isLastAnswerCorrect = false;
            recordWrongQuestion(currentQuestion);
        }
        
        startNextCountdown(3, () => {
            if (currentMode === 'suddendeath' && !isLastAnswerCorrect) return showResult(true);
            currentQuestionIndex++;
            if (currentQuestionIndex < activeQuizData.length) startQuestion();
            else showResult(false);
        });
    }
}

function startNextCountdown(seconds, callback) {
    clearInterval(nextCountdownInterval);
    nextCountdownText.classList.remove("hidden");
    let count = seconds;
    nextCountdownText.textContent = `次の問題まで残り ${count} 秒`;

    nextCountdownInterval = setInterval(() => {
        count--;
        if (count > 0) {
            nextCountdownText.textContent = `次の問題まで残り ${count} 秒`;
        } else {
            clearInterval(nextCountdownInterval);
            nextCountdownText.classList.add("hidden");
            if (callback) callback();
        }
    }, 1000);
}

// ⏩ オフライン専用：Qキーによる問題スキップ処理
function skipQuestionOffline() {
    if (isOnlineMode) return; // オンライン時は無効
    clearInterval(textInterval);
    clearInterval(answerTimer);
    clearInterval(nextCountdownInterval);
    clearTimeout(autoNextTimer);
    
    currentQuestionIndex++;
    if (currentQuestionIndex < activeQuizData.length) {
        startQuestion();
    } else {
        showResult(false);
    }
}

function recordWrongQuestion(question) {
    if (!wrongQuestions.some(q => q.question === question.question)) {
        wrongQuestions.push(question);
        saveWrongQuestions(); 
    }
}

function scheduleAutoNextQuestion() {
    clearTimeout(autoNextTimer);
    autoNextTimer = setTimeout(async () => {
        if (!isHost || !currentRoomId) return;
        const roomRef = doc(db, "rooms", currentRoomId);
        const roomSnap = await getDoc(roomRef);
        if (!roomSnap.exists()) return;
        
        const data = roomSnap.data();
        const scores = data.scores || {};
        const winThreshold = parseInt(data.settings?.winCondition || 5, 10);
        
        const hasWinner = Object.values(scores).some(s => s >= winThreshold);
        const nextIdx = data.currentQuestionIndex + 1;

        if (hasWinner || nextIdx >= data.questions.length || nextIdx >= 30) {
            await updateDoc(roomRef, { status: "finished" });
        } else {
            await updateDoc(roomRef, {
                currentQuestionIndex: nextIdx,
                buzzerPlayer: null,
                lastAnswerResult: null,
                answeredPlayers: [],
                allWrongOrPassed: false,
                resumeIndex: 0
            });
        }
    }, 4000);
}

function showResult(isSuddenDeathGameOver, onlineScores = null) {
    quizScreen.classList.add("hidden");
    resultScreen.classList.remove("hidden");
    clearInterval(nextCountdownInterval);

    if (isOnlineMode && onlineScores) {
        document.getElementById("result-title").textContent = "🏆 対戦結果";
        const sorted = Object.entries(onlineScores).sort((a, b) => b[1] - a[1]);
        let resultHTML = "<ol style='text-align: left; display: inline-block; padding-left: 20px;'>";
        sorted.forEach(([name, sc], index) => {
            const crown = index === 0 ? "🥇 " : index === 1 ? "🥈 " : index === 2 ? "🥉 " : "👤 ";
            resultHTML += `<li style='margin: 4px 0; font-size: 1.1em;'>${crown}<strong>${name}</strong>: ${sc}点</li>`;
            if (name === myPlayerName) score = sc;
        });
        resultHTML += "</ol>";

        resultHTML += `
            <div style="margin-top: 10px;">
                <button id="rematch-btn" class="mode-btn nav-item" style="background-color: #ff9500;">🔄 もう一度遊ぶ（再戦）</button>
                <p id="rematch-status" style="font-size: 0.85em; color: #666;"></p>
            </div>
        `;
        document.getElementById("final-score").innerHTML = resultHTML;

        document.getElementById("rematch-btn").addEventListener("click", async () => {
            const roomRef = doc(db, "rooms", currentRoomId);
            const roomSnap = await getDoc(roomRef);
            if (roomSnap.exists()) {
                const votes = roomSnap.data().rematchVotes || [];
                if (!votes.includes(myPlayerName)) {
                    votes.push(myPlayerName);
                    await updateDoc(roomRef, { rematchVotes: votes });
                }
            }
        });

        saveHistory('online', difficultySelect.value, score, activeQuizData.length);
    } else {
        document.getElementById("result-title").textContent = isSuddenDeathGameOver ? "ゲームオーバー！" : "終了！";
        document.getElementById("final-score").textContent = isSuddenDeathGameOver ? `記録: ${score}問連続正解でした！` : `${activeQuizData.length}問中、${score}問正解しました！`;
        saveHistory(currentMode, difficultySelect.value, score, activeQuizData.length);
    }
    updateKeyboardFocus();
}

document.getElementById("back-home-btn").addEventListener("click", () => {
    if (isOnlineMode && unsubscribeRoom) unsubscribeRoom();
    isOnlineMode = false;
    currentRoomId = null;
    resultScreen.classList.add("hidden");
    startScreen.classList.remove("hidden");
    updateReviewButtonState();
    updateKeyboardFocus();
});

// ==========================================
// 🌐 オンライン対戦処理
// ==========================================

function populateLobbyGenreOptions() {
    lobbyGenre.innerHTML = '<option value="all">すべてのジャンル</option>';
    FIXED_TAGS.forEach(genre => {
        const opt = document.createElement("option");
        opt.value = genre;
        opt.textContent = genre;
        lobbyGenre.appendChild(opt);
    });
}

[lobbyWinCondition, lobbyDifficulty, lobbyGenre, lobbyPenalty].forEach(el => {
    if (!el) return;
    el.addEventListener("change", async () => {
        if (!isHost || !currentRoomId) return;
        try {
            const roomRef = doc(db, "rooms", currentRoomId);
            await updateDoc(roomRef, {
                settings: {
                    winCondition: lobbyWinCondition.value,
                    difficulty: lobbyDifficulty.value,
                    genre: lobbyGenre.value,
                    penalty: lobbyPenalty.value
                }
            });
        } catch (err) {
            console.error("設定変更エラー:", err);
        }
    });
});

document.getElementById("btn-create-room").addEventListener("click", async () => {
    myPlayerName = playerNameInput.value.trim();
    if (!myPlayerName) return alert("プレイヤー名を入力してください！");
    localStorage.setItem("quizPlayerName", myPlayerName);

    const roomId = Math.floor(1000 + Math.random() * 9000).toString();
    currentRoomId = roomId;

    try {
        await setDoc(doc(db, "rooms", roomId), {
            host: myPlayerName,
            players: [myPlayerName],
            scores: { [myPlayerName]: 0 },
            status: "waiting", 
            currentQuestionIndex: 0,
            buzzerPlayer: null,
            lastAnswerResult: null,
            answeredPlayers: [],
            allWrongOrPassed: false,
            resumeIndex: 0,
            rematchVotes: [],
            settings: {
                winCondition: "5",
                difficulty: "all",
                genre: "all",
                penalty: "none"
            }
        });

        showLobby(roomId, true);
        listenToRoom(roomId);
    } catch (error) {
        console.error("ルーム作成エラー:", error);
        alert("ルームの作成に失敗しました。");
    }
});

document.getElementById("btn-join-room").addEventListener("click", async () => {
    myPlayerName = playerNameInput.value.trim();
    if (!myPlayerName) return alert("プレイヤー名を入力してください！");
    localStorage.setItem("quizPlayerName", myPlayerName);

    const roomId = prompt("合言葉（4桁の数字）を入力してください");
    if (!roomId) return;

    currentRoomId = roomId;

    try {
        const roomRef = doc(db, "rooms", roomId);
        const roomSnap = await getDoc(roomRef);

        if (roomSnap.exists()) {
            const roomData = roomSnap.data();
            if (roomData.status !== "waiting") return alert("このルームは既にゲームが開始されています。");
            
            const updatedPlayers = [...roomData.players, myPlayerName];
            const updatedScores = { ...roomData.scores, [myPlayerName]: 0 };

            await updateDoc(roomRef, { 
                players: updatedPlayers,
                scores: updatedScores
            });

            showLobby(roomId, false);
            listenToRoom(roomId);
        } else {
            alert("ルームが見つかりません。合言葉を確認してください。");
        }
    } catch (error) {
        console.error("入室エラー:", error);
        alert("入室に失敗しました。");
    }
});

function showLobby(roomId, hostState) {
    isHost = hostState;
    document.getElementById("start-screen").classList.add("hidden");
    lobbyScreen.classList.remove("hidden");
    roomKeyDisplay.textContent = roomId;
    
    [lobbyWinCondition, lobbyDifficulty, lobbyGenre, lobbyPenalty].forEach(el => {
        if (el) el.disabled = !isHost;
    });

    if (isHost) {
        startRoomMatchBtn.classList.remove("hidden");
        guestRuleNotice.classList.add("hidden");
    } else {
        startRoomMatchBtn.classList.add("hidden");
        guestRuleNotice.classList.remove("hidden");
    }
    updateKeyboardFocus();
}

startRoomMatchBtn.addEventListener("click", async () => {
    if (!currentRoomId || !isHost) return;

    try {
        const roomRef = doc(db, "rooms", currentRoomId);
        const settings = {
            winCondition: lobbyWinCondition.value,
            difficulty: lobbyDifficulty.value,
            genre: lobbyGenre.value,
            penalty: lobbyPenalty.value
        };

        let roomQuestions = allQuizData;
        if (settings.difficulty !== "all") {
            roomQuestions = roomQuestions.filter(q => q.difficulty === settings.difficulty);
        }
        if (settings.genre !== "all") {
            roomQuestions = roomQuestions.filter(q => (q.genres && q.genres.includes(settings.genre)) || q.genre === settings.genre);
        }

        roomQuestions = shuffleArray(roomQuestions).slice(0, 30);
        if (roomQuestions.length === 0) return alert("選択された条件に該当する問題がありません！");

        const roomSnap = await getDoc(roomRef);
        const players = roomSnap.data().players;
        const initialScores = {};
        players.forEach(p => initialScores[p] = 0);

        await updateDoc(roomRef, {
            status: "playing",
            questions: roomQuestions,
            scores: initialScores,
            currentQuestionIndex: 0,
            buzzerPlayer: null,
            lastAnswerResult: null,
            answeredPlayers: [],
            allWrongOrPassed: false,
            resumeIndex: 0,
            rematchVotes: [],
            settings: settings
        });
    } catch (error) {
        console.error("ゲーム開始エラー:", error);
        alert("ゲームの開始に失敗しました。");
    }
});

showRuleBtn.addEventListener("click", () => {
    if (!roomDataCache || !roomDataCache.settings) return;
    const s = roomDataCache.settings;
    const diffLabel = s.difficulty === 'all' ? 'すべて' : s.difficulty === 'beginner' ? '初級' : '上級';
    const penaltyLabel = s.penalty === 'minus1' ? '-1点減点' : '減点なし';
    
    ruleModalBody.innerHTML = `
        <p><strong>🎯 勝利条件:</strong> 先に <strong>${s.winCondition}問</strong> 正解</p>
        <p><strong>📊 難易度:</strong> ${diffLabel}</p>
        <p><strong>🏷️ ジャンル:</strong> ${s.genre === 'all' ? 'すべてのジャンル' : s.genre}</p>
        <p><strong>⚠️ 誤答ペナルティ:</strong> ${penaltyLabel}</p>
    `;
    ruleModal.classList.remove("hidden");
});
document.getElementById("close-rule-modal-btn").addEventListener("click", () => ruleModal.classList.add("hidden"));

function listenToRoom(roomId) {
    const roomRef = doc(db, "rooms", roomId);
    
    unsubscribeRoom = onSnapshot(roomRef, (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        roomDataCache = data;
        
        if (data.settings) {
            lobbyWinCondition.value = data.settings.winCondition || "5";
            lobbyDifficulty.value = data.settings.difficulty || "all";
            lobbyGenre.value = data.settings.genre || "all";
            if (lobbyPenalty) lobbyPenalty.value = data.settings.penalty || "none";
        }

        if (data.status === "waiting") {
            playersListEl.innerHTML = "";
            data.players.forEach(player => {
                const li = document.createElement("li");
                li.textContent = player === data.host ? `👑 ${player}` : `👤 ${player}`;
                playersListEl.appendChild(li);
            });
            return;
        }

        if (data.scores) {
            onlineScoreboard.innerHTML = Object.entries(data.scores)
                .map(([name, sc]) => `<div>${name === myPlayerName ? '⭐ ' : ''}${name}: ${sc} pt</div>`)
                .join('');
        }

        if (data.status === "playing" && quizScreen.classList.contains("hidden")) {
            isOnlineMode = true;
            currentMode = 'online';
            activeQuizData = data.questions || allQuizData;
            lobbyScreen.classList.add("hidden");
            resultScreen.classList.add("hidden");
            quizScreen.classList.remove("hidden");
            onlineScoreboard.classList.remove("hidden");
            showRuleBtn.classList.remove("hidden");
            
            modeLabelEl.textContent = `オンライン対戦 / ルーム: ${currentRoomId}`;
            currentQuestionIndex = data.currentQuestionIndex || 0;
            startQuestion(data.resumeIndex || 0);
            return;
        }

        if (data.status === "playing" && data.currentQuestionIndex !== currentQuestionIndex) {
            currentQuestionIndex = data.currentQuestionIndex;
            startQuestion(0);
            return;
        }

        if (data.status === "playing" && data.buzzerPlayer && currentBuzzerPlayer !== data.buzzerPlayer) {
            currentBuzzerPlayer = data.buzzerPlayer;
            isBuzzed = true;
            clearInterval(textInterval);
            buzzerBtn.disabled = true;

            if (currentBuzzerPlayer === myPlayerName) {
                resultMessageEl.textContent = "🔔 あなたがボタンを押しました！";
                resultMessageEl.style.color = "#007aff";
                showOptions();
            } else {
                resultMessageEl.textContent = `🔔 ${currentBuzzerPlayer} さんがボタンを押しました！`;
                resultMessageEl.style.color = "#ff9500";
                optionsContainer.innerHTML = "";
                optionsContainer.classList.add("hidden");
            }
        }

        if (data.status === "playing" && data.lastAnswerResult) {
            const res = data.lastAnswerResult;
            
            if (res.isCorrect) {
                resultMessageEl.textContent = `⭕ ${res.player} さんが正解！ (${res.answer})`;
                resultMessageEl.style.color = "#34c759";
                startNextCountdown(4);
                if (isHost) scheduleAutoNextQuestion();
            } 
            else if (data.allWrongOrPassed) {
                const currentQuestion = activeQuizData[currentQuestionIndex];
                questionTextEl.textContent = currentQuestion.question;
                resultMessageEl.textContent = `❌ 全員不正解... (正解: ${currentQuestion.answer})`;
                resultMessageEl.style.color = "#ff3b30";
                startNextCountdown(4);
                if (isHost) scheduleAutoNextQuestion();
            } 
            else {
                const penaltyMsg = data.settings?.penalty === "minus1" ? " (-1点)" : "";
                resultMessageEl.textContent = `❌ ${res.player} さんが不正解${penaltyMsg}！続きます...`;
                resultMessageEl.style.color = "#ff9500";
                
                setTimeout(() => {
                    if (data.status === "playing" && data.currentQuestionIndex === currentQuestionIndex && !data.lastAnswerResult?.isCorrect && !data.allWrongOrPassed) {
                        currentBuzzerPlayer = null;
                        if (isHost) {
                            updateDoc(roomRef, {
                                buzzerPlayer: null,
                                lastAnswerResult: null,
                                resumeIndex: data.buzzIndex || 0
                            });
                        }
                        startQuestion(data.buzzIndex || 0);
                    }
                }, 2000);
            }
        }

        if (data.status === "finished") {
            clearTimeout(autoNextTimer);
            clearInterval(nextCountdownInterval);
            showResult(false, data.scores || {});
            
            const votes = data.rematchVotes || [];
            const rematchStatusEl = document.getElementById("rematch-status");
            if (rematchStatusEl) {
                rematchStatusEl.textContent = `再戦準備: ${votes.length} / ${data.players.length} 人`;
            }

            if (isHost && votes.length >= data.players.length && votes.length > 0) {
                startRoomMatchBtn.click();
            }
        }
    });
}

document.getElementById("leave-room-btn").addEventListener("click", () => {
    if (unsubscribeRoom) unsubscribeRoom();
    currentRoomId = null;
    isOnlineMode = false;
    lobbyScreen.classList.add("hidden");
    startScreen.classList.remove("hidden");
    updateKeyboardFocus();
});

// ==========================================
// ⌨️ 全画面共通 キーボードナビゲーションシステム
// ==========================================
let focusIndex = 0;

function getVisibleNavItems() {
    // 現在表示されている画面の中にあるクリック可能な .nav-item を全取得
    const visibleScreens = [startScreen, genreScreen, packScreen, createScreen, quizScreen, resultScreen, lobbyScreen];
    const currentScreen = visibleScreens.find(s => !s.classList.contains("hidden"));
    if (!currentScreen) return [];
    
    // クイズ画面かつ選択肢表示中なら選択肢のみをナビ対象にする
    if (currentScreen === quizScreen && !optionsContainer.classList.contains("hidden")) {
        return Array.from(optionsContainer.querySelectorAll(".nav-item:not(:disabled)"));
    }
    
    return Array.from(currentScreen.querySelectorAll(".nav-item:not(.hidden):not(:disabled)"));
}

function updateKeyboardFocus(setIndex = null) {
    const items = getVisibleNavItems();
    items.forEach(el => el.classList.remove("kb-focused"));
    if (items.length === 0) return;
    
    if (setIndex !== null) focusIndex = setIndex;
    if (focusIndex < 0) focusIndex = 0;
    if (focusIndex >= items.length) focusIndex = items.length - 1;

    items[focusIndex].classList.add("kb-focused");
}

document.addEventListener("keydown", (e) => {
    // モーダル表示中はモーダルの操作を優先
    if (!helpModal.classList.contains("hidden") || !ruleModal.classList.contains("hidden")) {
        if (e.code === "Enter" || e.code === "Space" || e.code === "Escape") {
            helpModal.classList.add("hidden");
            ruleModal.classList.add("hidden");
        }
        return;
    }

    // フォーム入力中はキー操作を無効化
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;

    const key = e.code;
    const items = getVisibleNavItems();

    // 1. 上下矢印 / W S キーによるフォーカス移動
    if (key === "ArrowUp" || key === "KeyW") {
        e.preventDefault();
        if (items.length > 0) {
            focusIndex = (focusIndex - 1 + items.length) % items.length;
            updateKeyboardFocus();
        }
    } else if (key === "ArrowDown" || key === "KeyS") {
        e.preventDefault();
        if (items.length > 0) {
            focusIndex = (focusIndex + 1) % items.length;
            updateKeyboardFocus();
        }
    }

    // 2. Space / Enter キーによる決定・早押し
    else if (key === "Space" || key === "Enter") {
        e.preventDefault();
        // クイズ画面で早押しボタンが有効な時は早押しを優先
        if (!quizScreen.classList.contains("hidden") && optionsContainer.classList.contains("hidden")) {
            if (!buzzerBtn.disabled) buzzerBtn.click();
        } else if (items.length > 0 && items[focusIndex]) {
            items[focusIndex].click();
        }
    }

    // 3. 数字キー 1〜4 (選択肢ダイレクト選択)
    else if (!quizScreen.classList.contains("hidden") && !optionsContainer.classList.contains("hidden")) {
        const optionButtons = optionsContainer.querySelectorAll(".option-btn");
        let selectedIndex = -1;
        if (key === "Digit1" || key === "Numpad1") selectedIndex = 0;
        if (key === "Digit2" || key === "Numpad2") selectedIndex = 1;
        if (key === "Digit3" || key === "Numpad3") selectedIndex = 2;
        if (key === "Digit4" || key === "Numpad4") selectedIndex = 3;

        if (selectedIndex !== -1 && optionButtons[selectedIndex] && !optionButtons[selectedIndex].disabled) {
            optionButtons[selectedIndex].click();
        }
    }

    // 4. Q キー：オフライン限定即時問題スキップ
    else if (key === "KeyQ" && !quizScreen.classList.contains("hidden")) {
        skipQuestionOffline();
    }
});