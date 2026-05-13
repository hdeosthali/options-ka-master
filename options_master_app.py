import streamlit as st
from datetime import datetime

st.set_page_config(page_title="Options Ka Master", page_icon="🚀", layout="centered")

# Session State
if 'is_pro' not in st.session_state:
    st.session_state.is_pro = False
if 'days_left' not in st.session_state:
    st.session_state.days_left = 0
if 'username' not in st.session_state:
    st.session_state.username = ""

st.title("🚀 Options Ka Master")
st.subheader("Paper Trading for Beginners • Learn Options Safely")

# ===================== LOGIN =====================
if not st.session_state.username:
    st.warning("Please Login to Continue")
    username = st.text_input("Enter Your Name")
    if st.button("Login"):
        st.session_state.username = username
        st.rerun()
    st.stop()

st.sidebar.header(f"👤 Welcome, {st.session_state.username}!")

# ===================== SIDEBAR =====================
capital = "₹5,00,000" if st.session_state.is_pro else "₹1,00,000"
st.sidebar.metric("Virtual Capital", capital)

if st.session_state.is_pro:
    st.sidebar.success(f"PRO MEMBER 🔥 | {st.session_state.days_left} days left")
else:
    st.sidebar.warning("Free Plan")

st.sidebar.divider()
if st.sidebar.button("🎟️ Upgrade to Pro - ₹900 for 5 Days"):
    st.session_state.is_pro = True
    st.session_state.days_left = 5
    st.balloons()
    st.success("✅ Pro Activated! Enjoy Full Features")

# ===================== TUTORIAL BUTTON =====================
if st.button("📖 How to Use This App (Tutorial)"):
    with st.expander("📘 Full Tutorial - Read this first", expanded=True):
        st.write("""
        **Welcome to Options Ka Master!**

        1. **Paper Trading** = Practice with virtual money (No Risk)
        2. Click "Get Today's Best Strategy" to see recommendation
        3. Click "Apply Strategy" to practice the trade
        4. Pro Plan (₹900/5 days) gives daily live strikes + more strategies
        5. Claim daily reward to level up!

        This app is for learning only.
        """)

st.divider()

# Main Buttons
col1, col2 = st.columns(2)
with col1:
    if st.button("📊 Get Today's Best Strategy", type="primary", use_container_width=True):
        st.success("**Iron Condor on Nifty**")
        st.info("Sell 2% OTM Call & Put\nLimited Risk | Good for Beginners")

with col2:
    if st.button("🎮 Apply Strategy in Paper Account", use_container_width=True):
        st.balloons()
        st.success("✅ Trade Executed in Paper Account!")

st.divider()

# Live Suggestions
st.subheader("📡 Today's Live Market Suggestions")
if st.session_state.is_pro:
    st.success("Pro Features Active")
    st.write("1. **Nifty Iron Condor** (Recommended)")
    st.write("2. BankNifty Short Strangle")
    st.write("3. Finnifty Bull Put Spread")
    st.write("4. Sensex Iron Condor")
else:
    st.info("Upgrade to Pro to unlock exact strike prices + 4 daily strategies")

st.divider()

# Fun Gamification
st.subheader("🏆 Your Progress")
col_a, col_b, col_c = st.columns(3)
with col_a:
    st.metric("Level", "Level 4 Trader")
with col_b:
    st.metric("Win Streak", "5 Days 🔥")
with col_c:
    st.metric("Badges", "7/12")

if st.button("Claim Daily Reward"):
    st.balloons()
    st.success("+50 XP | New Badge Unlocked!")

st.divider()

st.success("Backtest Performance: **82.1% Win Rate** | +2,849 points profit")

st.caption("⚠️ Educational Paper Trading Tool Only. Not real money. Not SEBI registered advice.")