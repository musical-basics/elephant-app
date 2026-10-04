# Queue calculations

The source workbook is `Elephant Calculations.xlsx`. `Sheet2` contains the detailed master-list and TakeABite examples; `Sheet1` contains the compact numeric scenarios. Worksheet names, rather than their underlying XML filenames, are used below.

The master-list link is hidden by default in both new and demo workspaces, as specified by the product writeup. Users can reveal it in Settings.

## Project placeholders

An active project's entries in the master list are placeholders. In queue order, they resolve to its first, second, and subsequent unfinished steps. Project steps keep their own order. Reordering, inserting, or splitting a step changes the contents of those placeholders without moving errands or other projects.

`Sheet2!A14:C26` establishes that position is **one-based**: position equals index plus one. Let N be the current master-list length and L the position of the project's last placeholder:

```
Project ready score = 1 - L / N
```

The workbook's original insertion threshold depends on a user setting that is excluded from this version. All projects instead use the same fixed threshold of **1/3**. There is no per-project pacing setting. This is an implementation assumption, not a separate formula provided by the workbook.

After adding or completing an item, process active projects in their stored order. If a project has another unfinished step and its score is **strictly greater than 1/3**, append one placeholder to the queue. At most one placeholder is added per project per pass. Existing slots remain in place. The implementation compares `3 * (N - L) > N`, the exact integer equivalent, so floating-point rounding cannot activate a project at equality.

An active project with unfinished steps but no placeholder receives one, including when the queue is empty. This supplies the otherwise unspecified empty-queue and zero-placeholder behavior. Inactive and completed projects have no placeholders. There can never be more placeholders than unfinished steps.

## Workbook examples

| Source | N | L | Score | Result at threshold 1/3 |
| --- | ---: | ---: | ---: | --- |
| `Sheet1!E3:G8` | 10 | 8 | 0.2 | No insertion |
| `Sheet1!E13:G18` | 9 | 7 | 0.222222… | No insertion |
| `Sheet1!E22:G27` | 11 | 7 | 0.363636… | Append one placeholder |
| `Sheet1!E31:H36` | 12 | 12 | 0 | No further insertion |

`Sheet2!A42:C47` uses a different original threshold, 1/4. Its score of 2/7 activates a step in that example but does not activate one under this version's uniform 1/3 threshold.

## Taking a bite

`Sheet2!A125:D154` provides the concrete split example. Rename the current step to the first text field and insert the second text field immediately after it in project order. Do **not** complete the first bite and do **not** run reprocessing.

The example's project occupies master-list positions 1, 4, and 7. Splitting its first step leaves those slots at 1, 4, and 7. They now show the first bite, the second bite, and the former second step. The former third step becomes queued for later within the project. Every errand stays in place.

For a standalone errand, the product writeup (`Elephant V1.0 Writeup v2.pdf`, Take a Bite) specifies that the new unfinished remainder goes to the bottom of the master list. The first bite stays in its existing position. This does not reprocess unrelated projects.

## Completion and source inconsistencies

Completing the current item timestamps it, removes its consumed slot, and reprocesses the remaining queue. A nonempty project automatically completes when all its steps have been completed. Adding a step to a completed project reopens it. Deleting the last step does not claim the project is completed.

The compact sheet has stale manual counts: `Sheet1!E32:E33` and `Sheet1!E41:E42` still show two active and three inactive items despite displaying three active positions. The implementation derives counts from current data. The compact prose also calls L an “index”; the detailed sheet explicitly establishes one-based position and its examples agree with that interpretation.

`Sheet2!A12` broadly says reprocessing runs after every user action, but `Sheet2!A154` explicitly excludes TakeABite and limits the trigger to adding or completing an item. The implementation follows the more specific instruction. Project activation seeds a placeholder; deactivation removes that project's placeholders. Renaming, reordering, splitting, and deleting do not trigger insertion.

The model tests cover workbook numeric examples, the strict threshold boundary, placeholder order, split behavior, completion, empty queues, immutable updates, backup validation, and CSV formula escaping.
