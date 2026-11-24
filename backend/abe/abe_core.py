# Initialize encryption engine

cpabe = CPABE()

# Define access policy

policy = AccessPolicy(
    expression="Department:IT AND Role:Admin",
    attributes=[
        "Department:IT",
        "Role:Admin"
    ]
)

# Encrypt message

encrypted = cpabe.encrypt(
    "Confidential NSOC 2026 Data",
    policy
)

print("Encrypted:", encrypted)


# Authorized user attributes

user_attributes = [
    Attribute(
        name="Department:IT",
        value="IT",
        issuer="Authority"
    ),
    Attribute(
        name="Role:Admin",
        value="Admin",
        issuer="Authority"
    )
]

# Decrypt message

result = cpabe.decrypt(
    encrypted,
    user_attributes
)

print("Decrypted:", result["plaintext"])
