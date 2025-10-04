import sys

def process_emails(input_file: str) -> str:
    """Reads emails from a file (one per line) and returns a comma-separated string."""
    try:
        with open(input_file) as f:
            emails = [line.strip() for line in f if line.strip()]
        return ",".join(emails)
    except FileNotFoundError:
        print(f"Error: Input file not found at '{input_file}'", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python process_emails.py <input_file>", file=sys.stderr)
        sys.exit(1)

    input_file = sys.argv[1]
    email_string = process_emails(input_file)
    print(email_string)
