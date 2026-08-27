# Asking a local agent

## Purpose

The page says where the weight of a repository sits.
It does not say why, and the reader who wants to know why has a coding agent installed already.

So the page can hand a question to that agent.
The reader types the question, the server writes what they are looking at, and the agent answers into the page.

Nothing is sent anywhere by Slopsplorer.
The agent runs on the same machine, under the reader's own sign-in, and it answers about the tree the page is measuring.

## The parts

```
src/agents/     definitions -> discover -> ask store, one process per question
src/server/     ScanIndex + AskRequest -> composeBrief -> the text the agent reads
src/web/        AgentPicker -> AskDialog -> AskDock -> AnswerDialog
```

`src/agents/` knows how to run a command line tool and nothing about a scan.
`src/server/brief.ts` knows about the scan and nothing about a process.

## Which agents are offered

`AGENT_DEFINITIONS` in `src/agents/definitions.ts` is the table of known tools, one entry each for Claude Code and Codex.
An entry says how to run the tool: how to ask it its version, how to ask it whether it is signed in, what argument list one question is, and where the answer comes back.
The tools agree about none of those four, so each entry answers them itself and no branch is shared.

`discoverAgents()` runs the two probes once, before the server listens, and the command line prints what it found.
A tool must pass both to be offered: it must start, and it must report that it is signed in.
A tool that fails either is left out, because a button that fails only after the reader has typed a question is worse than no button.

Discovery, and every ask, resolves the command outside the `node_modules/.bin` folders npm puts in front of `PATH`.
`npx slopsplorer` is a script npm runs, so without that rule a stale copy of an agent in any ancestor folder would be chosen over the one the reader installed and signed in.
`pathOutsidePackageBins()` in `src/agents/process.ts` holds the rule, and nothing else about the environment is changed.

## The brief

`composeBrief()` in `src/server/brief.ts` writes everything the agent is given.
It runs `buildView()` for the request the page sent, so the figures in the brief are the figures on the screen.

The brief names the subject, which is a scanned folder or a comparison of two revisions.
It then names the unit, the drill path, the selection, the flavors counted, the path filter, the last file the reader opened, and what the selection and the scope weigh.
The reader's question follows, and an empty one becomes a request to describe the page.

It is written on the server and not in the browser for one reason: the figures must be the aggregator's own.
The whole text is kept on the task, and the answer dialog draws it under the answer, so what the agent was told is never something the reader has to take on trust.

The brief tells the agent to answer in Markdown and to change nothing.
That instruction is not what makes the run safe.
Claude Code is asked in `plan` mode and Codex in the `read-only` sandbox, so neither can write whatever it is told.

## Running one ask

`createAskStore()` in `src/agents/ask.ts` holds the asks of one server run.
`start()` spawns the tool with an argument list, never through a shell, in the root the page is measuring, and returns at once.
A question is one argument, so a question that reads like a command line is still a question.

An ask ends in one of three ways.
The tool exits cleanly and its answer is read, by the route each definition names: the JSON on stdout for Claude Code, the last-message file for Codex.
The tool exits with a failure, and the reader is told what it said.
The tool passes the fifteen minute ceiling, and it is stopped and said to have been.

There is no cancelled state.
The `x` on a floater stops the process if it still runs and drops the task either way, because that is what dismissing a thing means.
Closing the server stops every ask, so no agent answers into a process that has gone.

The store is memory only.
An answer describes a scan that only this process holds, so it cannot outlive it.

## The routes

| Route | Purpose |
| --- | --- |
| `GET /api/agents` | The agents this host was found able to run. |
| `POST /api/ask` | Start one agent on one question. Returns the task, running. |
| `GET /api/asks` | Every ask of this server run, newest first. |
| `POST /api/ask-dismiss` | Stop an ask if it runs, drop it, and return what is left. |

The page polls `/api/asks` while any ask is running, and stops when none is.
One list is the whole client state, so a reload finds the asks still running and the answers already back.

## The page

The agent picker is a split control in the instrument bar: the wide half asks the chosen agent, and the chevron opens the list of the others.
The choice is kept in local storage, so the reader chooses an agent once.

The dialog holds the question and nothing else.
Everything about the page state is added by the server, so the brief cannot describe a view the browser has since left.

A running ask waits in the dock at the foot of the window, newest nearest the corner.
An agent takes minutes, and holding the page still for that long would make the tool unusable, so an ask never blocks anything.
A finished chip opens the answer.

`renderMarkdown()` in `src/web/markdown.tsx` draws the answer.
The Markdown is lexed and built as React elements, and it is never turned into an HTML string and injected.
A model wrote the text, so nothing in it may become markup: raw HTML in an answer is drawn as the characters it is written as, and a link is drawn as a link only for `http`, `https`, `mailto`, and a relative path.
The one string handed to the browser as HTML is the highlighter's, and the highlighter escapes the text before it colours it.
