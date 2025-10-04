import requests
import warnings
from datetime import datetime

warnings.filterwarnings("ignore")

class RegisterClient:
    def __init__(self, base_url="https://localhost/api/v1", verify_ssl=False):
        self.base_url = base_url
        self.verify_ssl = verify_ssl
        self.counter = 0

    def register(self, email: str, name: str, team_name: str = None):
        url = f"{self.base_url}/auth/register"
        payload = {
            "openid_sub": f"sub{self.counter}",
            "email": email,
            "name": name,
        }
        resp = requests.post(url, json=payload, verify=self.verify_ssl)
        resp.raise_for_status()
        data = resp.json()

        api_key = data["api_key"]
        user_id = f"u{self.counter}"
        team_id = f"t{self.counter}"
        self.counter += 1

        if team_name is None:
            team_name = f"{name}'s Team"

        # Print the JS localStorage lines
        print(f"localStorage.setItem('apiKey', '{api_key}')")
        print(
            "localStorage.setItem('user', JSON.stringify({ id: "
            f"'{user_id}', email: '{email}', name: '{name}', created_at: '{datetime.utcnow().isoformat()}' }}))"
        )
        print(
            "localStorage.setItem('teams', JSON.stringify([{ id: "
            f"'{team_id}', name: \"{team_name}\", role: 'admin' }}]))"
        )


if __name__ == "__main__":
    client = RegisterClient(verify_ssl=False)

    # Example usage
    client.register("ez255@cornell.edu", "Admin", team_name="Admin's Team")
    print()
    client.register("ericericzhouzhou@gmail.com", "Eric", team_name="Eric's Team")
    print()
    client.register("cireuohz@gmail.com", "Cire", team_name="Cire's Team")

