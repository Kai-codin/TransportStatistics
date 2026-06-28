import requests
import json

def main():
    # Ask user for ATCO code
    atco_code = input("Enter ATCO code (e.g. 9400ZZMAPIC): ").strip()

    url = "https://api-tf.tfgm.com/"

    headers = {
        "Host": "api-tf.tfgm.com",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0",
        "Accept": "*/*",
        "Accept-Language": "en-GB,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Referer": "https://tfgm.com/",
        "Content-Type": "application/json",
        "Origin": "https://tfgm.com",
        "Connection": "keep-alive",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
        "Pragma": "no-cache",
        "Cache-Control": "no-cache"
    }

    # IMPORTANT: Do NOT manually set Content-Length
    # requests handles it automatically

    payload = {
        "query": """
        query GetTramStopTravelInformation($atcoCodes: [String!]!, $limit: Int!) {
          tramStops: locationByAtco(atcoCodes: $atcoCodes) {
            name
            mode
            atcoCode
            ... on MassTransportLocation {
              lines {
                ... on TramLine {
                  id
                  mode
                  services {
                    name
                  }
                }
              }
              departures(limit: $limit) {
                trip {
                  __typename
                  mode
                  ... on TramTrip {
                    carriages
                    destinationDisplay
                  }
                }
                timings {
                  scheduledDepartureTime
                  expectedDepartureTime
                  lastUpdated
                  status
                  wait
                }
              }
              stopAlerts: alerts {
                ...AlertFragment
              }
            }
          }
          lineAlerts: transportModes(modes: [TRAM]) {
            alerts {
              ...AlertFragment
            }
          }
        }

        fragment AlertFragment on Alert {
          advice
          description
          title
          impactedServices {
            name
          }
          impactedLocations {
            atcoCode
            name
          }
          impactedServicesAtLocations {
            locations {
              atcoCode
              name
            }
            services {
              name
            }
          }
          id
          effect
          validityScopes
          validityPeriods {
            start
            end
          }
          link {
            href
            label
          }
        }
        """,
        "variables": {
            "atcoCodes": [atco_code],
            "limit": 20
        },
        "operationName": "GetTramStopTravelInformation"
    }

    try:
        response = requests.post(
            url,
            headers=headers,
            json=payload,  # CRITICAL: use json= not data=
            timeout=15
        )

        print("\nStatus Code:", response.status_code)
        print("\nResponse Headers:\n", response.headers)

        # Try to pretty print JSON
        try:
            print("\nResponse JSON:\n")
            print(json.dumps(response.json(), indent=2))
        except:
            print("\nRaw Response:\n")
            print(response.text)

    except requests.exceptions.RequestException as e:
        print("Request failed:", e)


if __name__ == "__main__":
    main()