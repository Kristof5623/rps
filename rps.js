let playerScore = 0;
let computerScore = 0;
let tie = 0;

const playerChoiceDisplay = document.getElementById("playerChoice");
const computerChoiceDisplay = document.getElementById("computerChoice");
const resultDisp = document.getElementById("result");
const win = document.getElementById("win");
const lose = document.getElementById("lose");
const tieDisp = document.getElementById("tie");
const resetBtn = document.getElementById("resetGame");
const targetURL = "index.html"; 

function navigateTo(url){
  if (!url) return;
  window.location.href = url;
}

document.addEventListener("keydown", (event1) => {
  if (event1.ctrlKey && event1.shiftKey && event1.code === "KeyA") {
    navigateTo(targetURL);
  }
});

const choices = Array.from(document.querySelectorAll(".choice"));
const things = ["rock", "paper", "sisors"]; // 'sisors' megtartva a meglévő logikához

const emojiMap = {
    rock: "🪨",
    paper: "📄",
    sisors: "✂️"
};

function playthis(playerChoice){
    const computerChoice = things[Math.floor(Math.random() * things.length)];
    let result = "";

    if (playerChoice === computerChoice){
        result = "It's a tie!";
    } else {
        switch (playerChoice){
            case "rock":
                result = (computerChoice === "sisors") ? "You win!" : "You lose!";
                break;
            case "paper":
                result = (computerChoice === "rock") ? "You win!" : "You lose!";
                break;
            case "sisors":
                result = (computerChoice === "paper") ? "You win!" : "You lose!";
                break;
            default:
                result = "Invalid";
        }
    }

    // UI update
    playerChoiceDisplay.textContent = `${emojiMap[playerChoice] || "—"} ${capitalizeLabel(playerChoice)}`;
    computerChoiceDisplay.textContent = `${emojiMap[computerChoice] || "—"} ${capitalizeLabel(computerChoice)}`;
    resultDisp.textContent = result;

    // result classes for color
    resultDisp.classList.remove("win","lose","tie");
    if (result === "You win!") resultDisp.classList.add("win");
    else if (result === "You lose!") resultDisp.classList.add("lose");
    else resultDisp.classList.add("tie");

    if (result === "You win!"){
        playerScore++;
    } else if (result === "You lose!"){
        computerScore++;
    } else if (result === "It's a tie!"){
        tie++;
    }

    win.textContent = playerScore;
    lose.textContent = computerScore;
    tieDisp.textContent = tie;
}

function resetGame(){
    playerScore = 0;
    computerScore = 0;
    tie = 0;
    win.textContent = "0";
    lose.textContent = "0";
    tieDisp.textContent = "0";
    resultDisp.textContent = "Válassz egyet";
    resultDisp.classList.remove("win","lose","tie");
    playerChoiceDisplay.textContent = "—";
    computerChoiceDisplay.textContent = "—";
}

function capitalizeLabel(s){
    if(!s) return "";
    if (s === "sisors") return "Olló";
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// attach click listeners
choices.forEach(btn => {
    btn.addEventListener("click", () => {
        const choice = btn.getAttribute("data-choice");
        playthis(choice);
    });
});

resetBtn.addEventListener("click", resetGame);

// initialise UI

resetGame();



