# output

Playtest artifacts from past sessions: replay JSON dumps and the `.py` / `.mjs`
dev scripts that drove the browser. `game/progress.md` cites these directories as
evidence behind past decisions, so the scripts, JSON and the `output/concepts`
image prompts stay tracked.

78 images (42 MB, against 152 KB of source in `game/app`) were removed from the
working tree at this commit: 71 session screenshots the scripts here wrote and
never read back, and 7 concept renders whose generation prompts are kept in
`output/concepts/*.txt`. Nothing in `game/` references any of them. New ones are
ignored by the `output/**/*.png` rule in the root `.gitignore`.

Git history is untouched, so every image is still retrievable:

    git log --all --diff-filter=D -- 'output/combat/audit/crowd.png'
    git show <commit>^:output/combat/audit/crowd.png > output/combat/audit/crowd.png

The first names the commit that deleted the file, the second restores the
byte-identical blob from its parent.
