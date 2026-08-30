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

`AGENT_DEFINITIONS` in `src/agents/definitions.ts` is the table of known tools: Claude Code, Codex, Cursor, and opencode.
An entry says how to run the tool: how to ask it its version, how to ask it whether it is signed in, what argument list one question is, and where the answer comes back.
The tools agree about none of those four, so each entry answers them itself and no branch is shared.

`discoverAgents()` runs the two probes once, before the server listens, and the command line prints what it found.
A tool that does not start is left out, because there is nothing to ask.
A tool that starts is offered, and what the sign-in probe said travels with it as `signedIn`, which the menu draws on the row.
Three of them report a sign-in directly, and opencode reports none of its own, so it is asked for its model list instead: an empty list is a tool that cannot answer whoever installed it.
opencode ships free models, so it usually passes with no credential at all, which is deliberate on its part and the right answer to the question actually being asked.

A tool that reports no sign-in can still be asked.
The probe reads what the tool says about itself, the reader is the one who knows whether it is right, and a run that fails says why in the card.

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
That instruction is a request and not a guarantee, so each tool is also asked in the most restricted mode it offers.
Claude Code gets `plan` mode, Codex the `read-only` sandbox, and Cursor `ask` mode, and none of the three can write whatever it is told.
opencode is asked as its `plan` agent, and what that agent may do is the reader's own opencode configuration rather than anything this repository can set, which is the one place the mode is a request too.

## Running one ask

`createAskStore()` in `src/agents/ask.ts` holds the asks of one server run.
`start()` spawns the tool with an argument list, never through a shell, in the root the page is measuring, and returns at once.
A question is one argument, so a question that reads like a command line is still a question.

An ask ends in one of three ways.
The tool exits cleanly and its answer is read, by the route each definition names: the JSON on stdout for Claude Code, the last-message file for Codex, plain stdout for Cursor, and the `text` events of the JSON stream for opencode.
A tool that exits cleanly and says nothing has failed, and is reported as having failed rather than drawn as an empty panel.
The tool exits with a failure, and the reader is told what it said.
The tool passes the fifteen minute ceiling, and it is stopped and said to have been.

There is no cancelled state.
The `x` on a floater stops the process if it still runs and drops the task either way, because that is what dismissing a thing means.
An agent runs its own tools as child processes, so it is started in a process group of its own and the group is what gets signalled: `SIGTERM`, then `SIGKILL` three seconds later for whatever ignored it.
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

The agent picker is a split control at the right of the filter bar, beside Open in: the wide half asks the chosen agent, and the chevron opens the list of the others.
Choosing a row changes the agent and asks nothing, because the two acts are the two halves of the control.
The choice is kept in local storage, so the reader chooses an agent once.

A row carries the tool's own mark, its name, and what the sign-in probe believed.
`AGENT_MARKS` in `src/web/components/AgentMark.tsx` holds the outlines, vendored from lobehub/lobe-icons so the page fetches nothing and no icon package is installed.
Claude and Codex keep their brand colours.
Cursor and opencode use black in light mode and white in dark mode.
The row text and control border show selection, so brand colour does not carry state.

The dialog holds the question and nothing else.
Everything about the page state is added by the server, so the brief cannot describe a view the browser has since left.

A running ask waits in the dock at the foot of the window, newest nearest the corner.
An agent takes minutes, and holding the page still for that long would make the tool unusable, so an ask never blocks anything.
A finished chip opens the answer.

`renderMarkdown()` in `src/web/markdown.tsx` draws the answer.
The Markdown is lexed and built as React elements, and it is never turned into an HTML string and injected.
A model wrote the text, so nothing in it may become markup: raw HTML in an answer is drawn as the characters it is written as, and a link is drawn as a link only for `http`, `https`, `mailto`, and a relative path.
The one string handed to the browser as HTML is the highlighter's, and the highlighter escapes the text before it colours it.
