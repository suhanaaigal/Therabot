# Crisis classifier data and evaluation

## Proxy training source

The local proxy-training dataset is [Suicide and Depression Detection](https://www.kaggle.com/datasets/nikhileswarkomati/suicide-watch), by Nikhileswar Komati. Kaggle lists it under **CC BY-SA 4.0**. The current Kaggle description says SuicideWatch posts were collected from Reddit and labelled `suicide`; r/teenagers posts were labelled `non-suicide`. It also says depression-subreddit posts are present in the collection; this project's binary version uses only its supplied `suicide` and `non-suicide` classes. Local inspection of version 14's `Suicide_Detection.csv` found 232,074 rows with columns `text` and `class`, balanced 116,037 per supplied class. Preparation removed one empty-text row, leaving 232,073 unique non-empty rows.

These subreddit-derived labels are noisy proxies, not clinical or clinician-reviewed ground truth. Posts are long Reddit submissions unlike short check-ins, and collection from public posts does not establish consent or clinical suitability. The corpus may contain sensitive user-generated text. Keep raw rows local; do not put examples in reports, slides, issue trackers, or model demos.

The Kaggle metadata identifies the dataset license as CC BY-SA 4.0. That license requires attribution and ShareAlike for adaptations that are distributed, and does not resolve privacy, publicity, or other rights that may apply to Reddit content. Before publishing or redistributing the dataset, model, or derived material, review the [current dataset page](https://www.kaggle.com/datasets/nikhileswarkomati/suicide-watch), the [CC BY-SA 4.0 terms](https://creativecommons.org/licenses/by-sa/4.0/), and applicable Reddit/source terms. The model remains local and research-only.

## Prepare and train locally

The repository includes a local archive ignored by Git. From `ml-service`:

```powershell
python -m text.prepare_crisis `
  --input data\kaggle_suicide_watch_v14.zip `
  --text-column text --label-column class `
  --positive-label suicide --negative-label non-suicide `
  --source-name "Suicide and Depression Detection (Nikhileswar Komati)" `
  --source-url "https://www.kaggle.com/datasets/nikhileswarkomati/suicide-watch" `
  --source-license "CC-BY-SA-4.0" `
  --output data\crisis_proxy.csv

python -m text.train_crisis_proxy `
  --csv data\crisis_proxy.csv `
  --output-dir outputs\crisis-proxy-minilm `
  --batch-size 128
```

The prepared data has deterministic stratified 70/15/15 train, validation, and proxy-test partitions. The validation partition alone selects the threshold for at least 90% proxy recall. The proxy test metrics evaluate that chosen threshold on a separate proxy-labelled split; they do not satisfy the independent short-text test requirement. The saved model is under `outputs/`, not `models/`, and is intentionally not loaded by the application.

## Independent short-text test and reviewers

Generate `evaluation\crisis_short_test_template.csv` with:

```powershell
python -m evaluation.make_crisis_short_test_template
```

Two reviewers must independently write or collect 150–300 short messages. Give each reviewer a separate copy containing the same messages and IDs, but only their own label column; do not let either reviewer see the other's labels before both copies are complete. Include direct and indirect statements, negations, figurative language, Hinglish, and at least 30% non-crisis messages. Keep text de-identified; do not copy public posts. Merge their labels by ID, compute agreement, discuss disagreements, and enter the agreed label in `adjudicated_label`. The evaluator requires at least 30% adjudicated non-crisis rows. The template is only a blank scaffold; it contains no fabricated messages or labels.

Once all rows are complete and independently reviewed, run:

```powershell
python -m evaluation.crisis_short_test `
  --csv evaluation\crisis_short_test_template.csv `
  --model outputs\crisis-proxy-minilm\model.joblib
```

This reports Cohen's kappa between the two independent reviewers and precision, recall, F1, and confusion matrix against adjudicated human labels, using the threshold selected from proxy validation only. It refuses to run on fewer than 150 or more than 300 rows, missing categories/labels, duplicate messages, and exact overlap with the proxy training corpus. The JSON summary omits raw message text.

Do not install this classifier in the live crisis path unless an appropriately qualified safety lead reviews the results and limitations. The existing deterministic crisis rules remain active. Neither proxy metrics nor a small authored test set establish clinical safety or diagnostic validity.
