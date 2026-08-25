# Process overview

## What I built

**Deflect** is a small browser game where the player draws lines to bounce a moving ball into a goal.

The ball keeps moving by itself, so the player cannot directly control it. Instead, the player changes its path by drawing lines for it to bounce from.

The final game has 16 levels. Early levels introduce simple bouncing and different angles. Later levels add fixed obstacles, limited ink, moving obstacles, longer routes, and more chances to recover from a bad bounce.

The game has no tutorial. The first levels are simple enough for the player to learn by trying.

It also has pause, restart, level select, an opening cover, and a brush cursor. Finishing Level 16 shows a `CONGRATULATIONS` animation with confetti and ends the game.

## The moments that mattered

Everything below was iterated locally before landing in a single commit,
[`787ad89`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Se-m1Ne/commit/787ad89712fa0174e41851fb88cbb3e174a5d9c3),
on top of the template's [`2e7ff14`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Se-m1Ne/commit/2e7ff14) initial commit. The moments themselves aren't split across separate commits — this section is a narrative account of that one commit's history, not a commit-by-commit log.

### 1. Moving away from the viewport idea

My first idea was a more meta browser game. The game world was larger than the screen, and the player could move the viewport with scrollbars or the keyboard.

I liked the idea of using the browser itself as part of the game, but it was very confusing when I tried it. It was not clear what the player was supposed to do, and some rules also behaved strangely when the browser was zoomed.

I tried fixing the rules, but the main problem was still there: the game needed too much explanation. That did not fit the no-tutorial requirement.

I therefore dropped this idea and started again.

The next idea used the mouse as a light source. Moving the mouse changed a shadow, and the player had to use the shadow to cover a target.

This was much easier to understand, but after making three levels I found that the whole game could be finished in about ten seconds. The interaction worked, but there was not enough to learn or improve at.

That made me change direction again instead of adding more similar levels.

### 2. Finding the final draw-and-bounce mechanic

The final direction came from the idea of drawing something that changes a moving object's path.

The player draws a line, the ball hits it, and the line changes the direction of the ball. This was simple enough to understand without instructions, but it also gave me much more room to make different levels.

I first made simple levels about bounce angles, then added obstacles, limited ink, multiple bounces, moving obstacles, and longer routes.

Playing the game also changed the design. For example, the ball originally did not bounce high enough, so I adjusted the physics. After that it felt too slow and floaty, so I made it move a little faster.

I also found some levels where the ball could reach the goal without the player doing anything. I moved the goals and obstacles so the player actually had to use the drawing mechanic.

Later, I stopped making the ink limit harder. Instead, I used more interesting obstacle layouts and moving obstacles. This gave the player more freedom to draw another line and save the ball after a bad bounce.

After testing the whole game, I found that it could still be finished quite quickly, so I extended it to 16 levels. The last levels combine the same mechanics instead of introducing completely new rules.

## Testing the final game

I used automated testing for one clear physics rule: how the ball reflects when it hits a drawn line.

For the rest, playing the game was more useful.

I played it to check things such as:

- whether the first move was understandable without instructions;
- whether the ball felt good to control;
- whether a level could accidentally finish without player input;
- whether obstacles felt fair;
- whether moving obstacles were readable;
- whether there was enough space to recover from a bad bounce;
- whether the whole game was long enough without becoming repetitive.

I also checked the game at the two marking sizes, 1920×1080 and 390×844.

The automated test checks that the rule works. Playing the game helped me decide whether that rule actually felt good to use.