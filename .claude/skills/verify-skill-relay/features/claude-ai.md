# claude.ai connector

## Sub-features
- Added under Settings, Connectors, Add custom connector, with Authentication on "No sign-in" (claude.ai detects this on its own)
- Every skill appears under Tool permissions as "Skill: <name>"
- Claude finds a skill through tool search and asks to use "Skill: <name> from <connector name>"

## How to get to it (user POV)
New chat, then "use my skills to audit the seo of trysignet.dev". Claude searches tools for "seo audit", loads `seo-audit`, and audits off the playbook.

## Driving it with claude-in-chrome
Open claude.ai/new, type the prompt into the composer, press Enter, wait, screenshot the approval card ("Claude wants to use Skill: seo-audit from skill relay"), click "Allow once". Then `$V logs 5` must show `{"rpc":"tools/call","tool":"seo-audit"}` at that time. The log line is the proof; the UI alone isn't.

## Gotchas
- Adding the connector means typing a URL that contains a token. The user does that step, never the agent.
- The Add custom connector dialog shows the full token; never screenshot it. The connector settings page truncates it, still crop it.
- With many connectors on, claude.ai's Tool access is "Load tools when needed" (+ menu in the composer, Connectors, Tool access at the bottom). Tools stay hidden until the model searches, so "audit the seo" alone goes to web fetch with zero Lambda requests. "use my skills" makes it search.
- After a deploy that changes tool names, reopen the connector page or re-add it; claude.ai caches the tool list.
