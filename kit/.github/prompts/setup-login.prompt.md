---
name: setup-login
description: Set up how the UAT tests log in to this app (once per app), and prove every test account logs in.
agent: uat-login-setup
---
Set up login for the app under test: ask me which login pattern the app has and what shows that a
user is logged in, map the login page, write tests/login.ts, then run the login check for every
account in .env.example and show me its lines. Never ask for or read a password.
