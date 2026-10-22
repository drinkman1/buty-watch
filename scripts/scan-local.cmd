@echo off
rem Tor b: sklepy, ktore blokuja IP GitHuba (Zalando, Zalando Lounge, JD Sports).
rem Odpalany co 15 min przez Harmonogram zadan (zadanie "buty-watch tor b").
rem Telegram: zmienne uzytkownika ZAKUPY_TELEGRAM_BOT_TOKEN i ZAKUPY_TELEGRAM_CHAT_ID.
cd /d "%~dp0.."
if not exist data-local mkdir data-local
echo ==== %date% %time% >> data-local\scan.log
node src\run.mjs --track b >> data-local\scan.log 2>&1
