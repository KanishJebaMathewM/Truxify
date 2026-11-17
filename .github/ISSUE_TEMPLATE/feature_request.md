
name: Feature Request
about: Suggest an idea or improvement for this project
title: "feat: "
labels: ["enhancement"]
assignees: []

body:
  - type: markdown
    attributes:
      value: |
        ## Feature Request
        Thank you for suggesting an improvement!

  - type: textarea
    id: problem
    attributes:
      label: Is your feature request related to a problem?
      description: Describe the problem clearly.
      placeholder: "I'm always frustrated when..."
    validations:
      required: true

  - type: textarea
    id: solution
    attributes:
      label: Describe the solution you'd like
      description: Clearly explain the feature or improvement you want.
      placeholder: "I would like to see..."
    validations:
      required: true

  - type: textarea
    id: alternatives
    attributes:
      label: Describe alternatives you've considered
      description: Explain other solutions or workarounds you have considered.
      placeholder: "I have considered..."
    validations:
      required: false

  - type: textarea
    id: additional-context
    attributes:
      label: Additional context
      description: Add screenshots, mockups, examples, or other relevant information.
      placeholder: "Additional details..."
    validations:
      required: false
