# Consented pilot: preparation and analysis guardrails

This file is a preparation checklist, not ethics approval or a participant consent form. Do not recruit or collect participant data until the responsible institution/ethics body and project supervisor have approved the protocol, consent materials, and data handling.

## Before recruitment

- Define the research question, intended population, inclusion/exclusion criteria, recruitment route, sample-size rationale, duration, and stopping rules with a qualified supervisor.
- Obtain the required institutional/ethics review and written informed consent. Explain that participation is voluntary, withdrawal is possible, the prototype is not clinical care, and scores are not diagnoses or treatment advice.
- Disclose every processor and destination: chat provider, ML service, storage location, any optional retrieval, access roles, deletion process, and backup limitations. Do not promise retention periods or confidentiality controls that have not been verified.
- Minimize collection. Do not include names, email addresses, phone numbers, raw chat, journal entries, or re-identification keys in the analysis file. Keep any linkage key separately with restricted access.
- Establish who may access data, secure transfer/storage, incident handling, withdrawal/deletion procedure, and the approved analysis timeline.
- Have a qualified clinician/researcher define the interpretation and review the plan for risk escalations.

## Measures and analysis

Use only a pre-specified, de-identified table with the columns in `pilot_template.csv`. `model_stress_prob` is a prototype probability, not a clinical test result. Report the number of complete records, missingness, distributions, and confidence intervals where appropriate. Spearman correlation with GAD-7 measures association; quadratic weighted kappa measures agreement between the supplied bands. Neither is diagnostic accuracy or evidence of clinical benefit.

Keep all pilot results exploratory. Do not tune a model or threshold on the pilot and then report the same pilot as independent validation. Preserve a data dictionary and version the exact model/configuration used. Do not publish small cells or free-text values that could identify participants.

## Closure

Only the approved research lead can confirm approval, consent, recruitment, data collection, or results. This repository contains no participant data or pilot findings. Complete the analysis only after those approvals and data exist.
