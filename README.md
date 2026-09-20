# Jira Poker frontend

[https://estimator-frontend-ashen.vercel.app](https://estimator-frontend-ashen.vercel.app)

This is a blind-poker application for software developers or SaaS teams to discuss tee-sizing any given feature, Jira ticket based on time and resources/complexity. This project was inspired by discussions during sprint planning sessions at work and how different team members contribute differently. I had deliberately not referred to any existing sprint planning tools or tee-shirt sizing tools on the market as this project is a personal response to a work experience. I chose the blind-poker style specifically as an unobstrusive conversation starter and platform to allow all members of the team to visibly and meaningfully contribute towards a sizing activity. Different levels of experience, personality style, involvement with a particular task can impact how sprint planning discussions proceed.

This tool is intended to be a way to be a level conversation starter. Feedback welcomed.

## Installation

You will require a local `.env` file with below variables:

```
PORT=3001
CORS_ORIGIN=http://localhost:5173
NODE_ENV=development
```

For running a local instance on your machine:

```
npm install
npm run dev // runs on localhost:3001

```

You will also need to run the [frontend component](https://github.com/rachelwong/estimator-frontend) as well.

## Description

This is the back-end NodeJS component to a full stack application that allows users to create sessions (stored on server side) to contribute to point-sizing a piece of work in a "blind-poker" style. This project was Claude Code assisted to explore the potential and functionalities it can offer, and how I can integrate it into my own thinking and workflows. Worth exploring would be

- DEPLOYMENT.md
- PLAN.md
- estimator-plan.md

I used spec-driven development with Claude Code. The resources that I used included:

- [Matt Pocock grilling skills](https://github.com/mattpocock/skills)
- adapted `agent.md` from [Fabien Saglard's version](https://fabiensanglard.net/agent.md/)
- Claude design skills
- impeccable and intent skills for design exploration

The estimator-plan.md was the original product plan that used MCPs to pull data from a [Notion doc](https://app.notion.com/p/rachelwong/Estimator-3bb375d34b3480548d26edd98dcc8a11?source=copy_link) and a [Miro board](https://miro.com/welcomeonboard/M3IrMjlGUzNFVDg1SXNtY2RVLzIvVDdkVUpsOUg0L1JPSVV4YTF3YThqaFJrR3pJcmdMellnK1ltcHlab3dMc1JDY0pNaVkwdTVKTElOY0NTa2wrZDVIanN5YVJXV1ZnekExWnB3elh0WFBDaVZSZUc4SkdXb0VBdEY5NkQ2YmZ0R2lncW1vRmFBVnlLcVJzTmdFdlNRPT0hdjE=?share_link_id=721456564705).

### Screenshots

<table align="center">
  <!-- First Row of Images -->
  <tr>
    <td align="center">
      <b>Welcome screen</b><br>
      <img src="public/WelcomePage.png" width="200" alt="Welcome screen">
    </td>
    <td align="center">
      <b>Create Session</b><br>
      <img src="public/CreateSession.png" width="200" alt="Create Session">
    </td>
    <td align="center">
      <b>Active Session</b><br>
      <img src="public/ActiveSession.png" width="200" alt="Active Session">
    </td>
  </tr>
  <!-- Second Row of Images -->
  <tr>
    <td align="center">
      <b>Join Session</b><br>
      <img src="public/JoinSession.png" width="200" alt="Join session">
    </td>
    <td align="center">
      <b>Active to end session</b><br>
      <img src="public/ActiveToEndSession.png" width="200" alt="Active to end session">
    </td>
    <td align="center">
      <b>End Session</b><br>
      <img src="public/EndSession.png" width="200" alt="End Session">
    </td>
  </tr>
</table>

## Features & Tech Stack

### Features

- routes to create, and get a session

### Tech stack

- Render web service (free-tier)
- NodeJS x Typescript
- Zod for request payload schema
- SocketIO

I also have to configure a cron-job every 10 minutes to keep the Render web service alive. This is because I'm on the free tier and 15 minutes of inactivity will spin down the service and require up to a 1 minute to restore. The 10-minute GET `/healthz` ping keeps the service up and running except for the period between 2am and 6am Sydney time. I am hoping that scoping down the cron-job period will help keep this within Render usage policy.

## Key learnings

> TL;DR not having backend experience means many of my prompts say `is this best practice`.

- managing documentation drift: monorepo approach would be better to house both front and backend
- managing usage limits: I'm currently on the lowest Claude Code Pro plan. So this [reddit advice](https://www.reddit.com/r/ClaudeAI/comments/1u7i5ow/pro_tip_reset_your_usage_limits_on_your_schedule/) is relevant: create a Claude Code Routine that runs daily, use Haiku, and just say something like "Hello, just respond with "hello"", 5 hours before you want your usage to reset
- Current process is Plan mode x grilling skills x human code review
- configuring memory.md and agents.md brings better quality and _succinct_ responses. I have found wading through paragraphs of text describing code to be a productivity tax to using something that's meant to accelerate it :shrug:.
- not having backend experience means many of my prompts say `is this best practice`
- Plan mode and break out the work into phases. Manually review each phase and manually commit is my preferred way to go at the moment, until I can find a way to confidently gatekeep quality.
- Skills: key things that I have asked Claude Code to do in terms of code conventions were very limited by comparison:
  - avoid magic strings/numbers
- backend claude experience is very different to the frontend claude experience

## Roadmap

Backend claude experience is very different to the frontend claude experience. I don't have much to lean on in terms of where else the backend can go, including refactoring.
