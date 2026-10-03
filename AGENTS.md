# Project Architecture Rules

- Mount start-of-shift tablet acknowledgements inside `OperatorLineGuard`, because only authenticated operator line screens may display them.