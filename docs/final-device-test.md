# Final device test

**Status: awaiting a device run.** This is a test worksheet, not a passed test record.
Fill it in after testing the submitted application on a real HoloLens 2.

| Field | Recorded value |
| --- | --- |
| Test date and timezone | Pending |
| Application commit (`git rev-parse HEAD`) | Pending |
| HoloLens OS and Edge versions | Pending |
| Camera source: HoloLens or companion | Pending |
| Test project and number of steps | Pending |
| Meta models actually called | Pending |
| Tester | Pending |

Start the app using [Local deployment](local-deployment.md#hololens-2-over-https).
Use a small project with reference photos and real Meta inference.

| Action | Expected result | Observed result |
| --- | --- | --- |
| Build a correct step, select Check Step | Separate fresh-image verification, then Next Step | Pending |
| Build an incorrect step, select Check Step | Correction guidance; an incorrect verdict does not verify the step | Pending |
| Correct the build and check again | A fresh image confirms the correction | Pending |
| Obtain an `uncertain` result, then wait at least 30 seconds | No automatic capture or Meta request while waiting | Pending |
| Select Check Again after `uncertain` | One new inspection capture; a correct result may trigger its separate verification | Pending |
| Verify the final step and select Finish | Completion panel and mascot in immersive XR | Pending |
| Select Restart Assembly | Step 1, no steps verified in the new run, completion cleared | Pending |
| Reload the project after restart | The new run remains active with its own progress | Pending |

If `uncertain` cannot be reproduced, record it as not observed rather than passed.
Record verdicts, request counts and any failures without API keys or private image data.
Keep recordings locally; link only to a deliberately published clip.

Finish currently requires verification of the last step only. It does not prove that every
earlier step was verified. Complete all steps in order for this test and record the verified
count shown at completion. Changing that rule is separate application work.
