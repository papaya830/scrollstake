# ScrollStake

> A gamified productivity platform powered by Solana where you and your friends stake real funds to beat doomscrolling. Get caught? Pay up

[![Video Walkthrough](https://img.shields.io/badge/YouTube-Video%20Demo-red)](https://youtu.be/vtLGnOVzGTI?si=Al3ANvIwBiEvOyGP)
[![Devpost](https://img.shields.io/badge/Devpost-ScrollStake-blue)](https://devpost.com/software/scrollstake)
[![Live App](https://img.shields.io/badge/Demo-Live%20App-brightgreen)](https://scrollstake-two.vercel.app/)

---

## 💡 Inspiration

Have you ever told your friends you're going to be "so locked in" today, only to end up spending the next three hours mindlessly doomscrolling? We definitely have.

We realized that willpower alone isn't always enough, so we wanted to create a way to hold ourselves accountable by putting our money where our mouth is. We built **ScrollStake**, a gamified productivity platform powered by the Solana blockchain where you and your friends collectively stake real funds to ensure you stay focused.

---

## ⚙️ What It Does

ScrollStake turns productivity into a high-stakes group challenge.

* **The Setup**: Users create or join a "lock-in" room powered by a Solana smart contract. As a group, friends agree on the stake (buy-in), the penalty amount for slipping up, any grace periods, and a custom blocklist of sites/apps that count as doomscrolling (e.g., TikTok, Twitter, Instagram).
* **The Detection**: Once the session begins, ScrollStake monitors your focus using a dual-approach: screen sharing and camera tracking.
* **The Penalty**: The moment our system detects you doomscrolling, the penalty is deducted from your stake. To add insult to injury, the app uses the ElevenLabs API to loudly and publicly shame you to the rest of the room.
* **The Aftermath**: When the session ends, users are greeted with a "Spotify Wrapped"-style session review, comparing your focus stats, penalty losses, and overall lock-in score against your friends.

---

## 🛠️ How We Built It

We combined real-time web technologies with decentralized blockchain architecture:

* **Frontend & UI**: We built the client using React/Next.js, focusing on a clean, gamified dashboard leveraging Tiger Data where users can view their stakes, session timers, and post-session "Wrapped" statistics.
* **Solana**: The core staking and penalty logic is handled via Solana smart contracts (written in Rust/Anchor). This ensures that the locked-in funds are held securely in escrow and automatically deducted based on session rules. Payments are also on Solana for instant settlement times + negligible transaction fees compared to the delays within the traditional banking system (could have ACH settlement delays (3–5 business days) and per-transaction interchange fees ($0.30 + 2.9%)). Everything is done onchain for transparent accountability.
* **Activity Detection**: To monitor the user, we captured the browser's ScreenShare and Webcam feeds. We utilized computer vision (OpenCV/Python) and URL/DOM tracking to determine if a user navigated to a blocked site or exhibited the physical behavior of mindless scrolling.
* **Audio Shame**: We integrated the ElevenLabs API to generate high-quality, dynamic voice alerts that trigger instantly upon detection, broadcasting the user's slip-up to the active room via WebSockets.

---

## 🚀 What's Next for ScrollStake

* **Improve Detection Accuracy**: This was an MVP built in under 24 hours, so our priority is to improve the accuracy and robustness of the doomscroll detection model.
* **Use it ourselves**: Once that's complete, we'd love to test this out with our friends to lock in for exam season!
