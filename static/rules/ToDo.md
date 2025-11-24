* Be able to call out crunch compresison and animation compression time vs importing
* Create better unit tests from log files

High Pri
* Make sure live file watching is working appropriately

Medium Pri
* Find a way to call out the difference between chunk wall-wall and summed wall-wall

Low Pri
* Test live file watching on windows and get that fully working

Priority 1:

Clarify to the parser how the behaviour should be for -timestamps and not timestamps

If we have timestamps, we should save single asset lines initially with the time read in the message, however when we encounter a new line, and a new timestamps, we should go back to the asset object we created, and readjust its start/end/duration ms with the new timestamp information.

I'd like you to do a full analysis of of chart widget code in charts.js

I would like you to consider how to refactor it with the primary goal in mind of making it human readable and understandable. Somebody should be able to follow the logic flow reasonably easier, and piece together the overall structure and steps.

You shouldn't just rely on good comments for this (although good comments are welcome) the code itself should be readable enough to understand the flow.

I do like your refactor of the log parser if that's helpful

Present a plan to me before proceeding


