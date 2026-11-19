
name: Bug report
about: Create a report to help us identify and fix a bug
title: "bug: "
labels: "type: bug"
assignees: ""

body:
  - type: textarea
    attributes:
      label: Describe the bug
      description: A clear and concise description of the bug.
    validations:
      required: true

  - type: textarea
    attributes:
      label: Steps to reproduce
      description: Steps to reproduce the behavior.
      placeholder: |
        1. Go to '...'
        2. Click on '...'
        3. Perform the following action
        4. Observe the error
    validations:
      required: true

  - type: textarea
    attributes:
      label: Expected behavior
      description: Describe what you expected to happen.
    validations:
      required: true

  - type: textarea
    attributes:
      label: Actual behavior
      description: Describe what actually happened.
    validations:
      required: true

  - type: textarea
    attributes:
      label: Screenshots
      description: Add screenshots or screen recordings if applicable.

  - type: textarea
    attributes:
      label: Environment
      description: Complete the following information.
      placeholder: |
        - Operating System:
        - OS Version:
        - App/Project Version:
        - Browser:
        - Browser Version:
        - Device:

  - type: textarea
    attributes:
      label: Additional context
      description: Add any other context about the bug.
