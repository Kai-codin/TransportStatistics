import Tabs from '@/components/Tabs';

export default function LegalPage() {
  const dataSources = [
    {
      source: 'OpenStreetMap (via Geofabrik)',
      desc: 'Map and geospatial data derived from © OpenStreetMap contributors. Used for stop locations, station geometry and mapping features.',
      license: 'Open Database License (ODbL) 1.0',
      link: 'https://opendatacommons.org/licenses/odbl/1-0/'
    },
    {
      source: 'NaPTAN (UK Department for Transport)',
      desc: 'Official UK stop registry containing bus stop locations and metadata. Contains public sector information licensed under the Open Government Licence v3.0.',
      license: 'Open Government Licence v3.0',
      link: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/'
    },
    {
      source: 'Realtime Trains (RTT)',
      desc: 'Train departures, schedules, platforms, delays and service metadata retrieved via the RTT API and normalised for display.',
      license: 'Data provided by Realtime Trains (realtimetrains.co.uk) for non-commercial use. All data remains the property of the original data sources.',
      link: 'https://www.realtimetrains.co.uk'
    },
    {
      source: 'Signalbox API',
      desc: 'Live train location, route and train metadata retrieved from Signalbox APIs (including /locations, /route and /train-information endpoints).',
      license: 'Data provided by Signalbox. Contains information of Network Rail Infrastructure Limited. Powered by National Rail Enquiries.'
    },
    {
      source: 'Bustimes.org',
      desc: 'Bus departures, vehicle positions, trip data and vehicle metadata retrieved via bustimes.org APIs (including stops, vehicles and trips endpoints).',
      license: 'Data provided by bustimes.org. See their data page for full licensing details.',
      link: 'https://bustimes.org/data'
    },
    {
      source: 'Map Styles & Tiles',
      desc: 'Map styles and tiles are served via third-party providers including custom styles and MapTiler fallback styles. These are based on OpenStreetMap data.',
      license: 'OpenStreetMap data © OpenStreetMap contributors (ODbL 1.0)'
    },
    {
      source: 'Project datasets',
      desc: 'Internally maintained datasets including fleet information, vehicle types, and livery definitions used to enrich transport data.',
    },
  ];

  const tabData = [
    {
        label: 'Terms of Service',
        content: (
            <div className="space-y-6">

            {/* Header */}
            <div>
                <h3 className="text-xl font-semibold text-ts-text-1">Terms of Service</h3>
                <p className="text-ts-text-2 mt-1">
                These terms govern your use of this service. By using the service, you agree to them.
                </p>
            </div>

            {/* Acceptance */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">Acceptance of Terms</h4>
                <p className="text-sm text-ts-text-2">
                By accessing or using this service, you agree to be bound by these Terms of Service.
                If you do not agree, you must not use the service.
                </p>
            </div>

            {/* Service Description */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">Service Description</h4>
                <p className="text-sm text-ts-text-2">
                This service provides transport data, tracking, and user-generated trip logging tools.
                Features may change, be updated, or be removed at any time without notice.
                </p>
            </div>

            {/* Accounts */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">Accounts</h4>
                <p className="text-sm text-ts-text-2">
                You are responsible for maintaining the security of your account. Authentication
                is provided via Clerk. You must not share your account or impersonate others.
                </p>
            </div>

            {/* Acceptable Use */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">Acceptable Use</h4>
                <ul className="text-sm text-ts-text-2 list-disc pl-5 space-y-1">
                <li>Do not misuse or attempt to disrupt the service</li>
                <li>Do not reverse engineer or exploit the platform</li>
                <li>Do not use the service for unlawful purposes</li>
                </ul>
            </div>

            {/* User Content */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">User Content</h4>
                <p className="text-sm text-ts-text-2">
                You retain ownership of any data you create (such as trip logs). By using the service,
                you grant us a limited right to store and process this data to operate the service.
                </p>
            </div>

            {/* Data Accuracy */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">Data Accuracy</h4>
                <p className="text-sm text-ts-text-2">
                Transport data is provided from third-party sources and may be incomplete,
                delayed, or inaccurate. This service is provided for informational purposes only
                and should not be relied upon for critical decisions.
                </p>
            </div>

            {/* Third Party Services */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">Third-Party Services</h4>
                <p className="text-sm text-ts-text-2">
                This service integrates third-party data providers and APIs. We are not responsible
                for the availability, accuracy, or content of third-party services.
                </p>
            </div>

            {/* Availability */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">Service Availability</h4>
                <p className="text-sm text-ts-text-2">
                The service is provided on an "as is" and "as available" basis. We do not guarantee
                uptime, availability, or error-free operation.
                </p>
            </div>

            {/* Liability */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">Limitation of Liability</h4>
                <p className="text-sm text-ts-text-2">
                To the maximum extent permitted by law, we are not liable for any indirect,
                incidental, or consequential damages arising from your use of the service.
                </p>
            </div>

            {/* Termination */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">Termination</h4>
                <p className="text-sm text-ts-text-2">
                We may suspend or terminate access to the service at any time, including for
                violations of these terms.
                </p>
            </div>

            {/* Changes */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">Changes to Terms</h4>
                <p className="text-sm text-ts-text-2">
                These terms may be updated from time to time. Continued use of the service
                constitutes acceptance of any changes.
                </p>
            </div>

            {/* Governing Law */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">Governing Law</h4>
                <p className="text-sm text-ts-text-2">
                These terms are governed by the laws of the United Kingdom.
                </p>
            </div>

            {/* Contact */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">Contact</h4>
                <p className="text-sm text-ts-text-2">
                For questions regarding these terms, contact:{' '}
                <a
                    href="mailto:support@transportstatistics.com"
                    className="text-ts-accent hover:underline"
                >
                    support@transportstatistics.com
                </a>
                </p>
            </div>

            </div>
        ),
    },
    {
        label: 'Privacy Policy',
        content: (
            <div className="space-y-6">
            {/* Header */}
            <div>
                <h3 className="text-xl font-semibold text-ts-text-1">Privacy Policy</h3>
                <p className="text-ts-text-2 mt-1">
                This policy explains what data we collect, how we use it, and your rights.
                </p>
            </div>

            {/* Overview */}
            <div className="text-sm text-ts-text-2 space-y-3">
                <p>
                We are committed to minimising data collection. This service only stores
                data required to provide core functionality such as authentication and
                trip logging.
                </p>
                <p>
                We do not sell personal data and we do not use personal data for advertising.
                </p>
            </div>

            {/* Data We Collect */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">Data We Collect</h4>
                <div className="text-sm text-ts-text-2 space-y-2">
                <p>
                    <strong>Account Data (via Clerk):</strong> Authentication and account
                    management are handled by Clerk. This may include your email address
                    and basic account identifiers.
                </p>

                <p>
                    <strong>User Data (stored by us):</strong> When using features such as
                    trip logging, we store data you explicitly create, including:
                </p>

                <ul className="list-disc pl-5 space-y-1">
                    <li>Trip logs (services, operators, routes, timestamps)</li>
                    <li>Optional notes and vehicle details</li>
                    <li>Associated stop and location references</li>
                </ul>

                <p>
                    <strong>We do not store:</strong> payment data, precise personal identity
                    details beyond authentication, or sensitive personal information.
                </p>
                </div>
            </div>

            {/* How Data Is Stored */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">How Data Is Stored</h4>
                <div className="text-sm text-ts-text-2 space-y-2">
                    <p>
                    Application data is stored on infrastructure operated by us using a self-hosted
                    Convex backend. This means we control how and where your data is stored.
                    </p>
                    <p>
                    Authentication data is processed and stored by Clerk as a third-party provider
                    acting as a data processor.
                    </p>
                </div>
            </div>

            {/* How We Use Data */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">How We Use Data</h4>
                <div className="text-sm text-ts-text-2 space-y-2">
                <ul className="list-disc pl-5 space-y-1">
                    <li>To provide core application functionality</li>
                    <li>To associate data with your account</li>
                    <li>To improve reliability and performance</li>
                </ul>
                </div>
            </div>

            {/* Data Sharing */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">Data Sharing</h4>
                <div className="text-sm text-ts-text-2 space-y-2">
                    <p>
                    We do not sell or share your personal data with third parties.
                    </p>
                    <p>
                    Data is only shared with service providers required to operate the service:
                    </p>
                    <ul className="list-disc pl-5 space-y-1">
                    <li>Clerk (authentication)</li>
                    </ul>
                </div>
            </div>

            {/* Data Retention */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">Data Retention</h4>
                <p className="text-sm text-ts-text-2">
                Data is retained only for as long as your account is active. You may request
                deletion of your data at any time.
                </p>
            </div>

            {/* Your Rights */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">Your Rights</h4>
                <div className="text-sm text-ts-text-2 space-y-2">
                <p>You have the right to:</p>
                <ul className="list-disc pl-5 space-y-1">
                    <li>Access the data we hold about you</li>
                    <li>Request correction of inaccurate data</li>
                    <li>Request deletion of your data</li>
                </ul>
                </div>
            </div>

            {/* Cookies */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">Cookies</h4>
                <p className="text-sm text-ts-text-2">
                We may use essential cookies required for authentication and basic
                functionality. These do not track you for advertising purposes.
                </p>
            </div>

            {/* Contact */}
            <div>
                <h4 className="font-semibold text-ts-text-1 mb-2">Contact</h4>
                <p className="text-sm text-ts-text-2">
                For privacy-related requests, contact:{' '}
                <a
                    href="mailto:support@transportstatistics.com"
                    className="text-ts-accent hover:underline"
                >
                    support@transportstatistics.com
                </a>
                </p>
            </div>

            {/* Footer note */}
            <div className="text-xs text-ts-text-3">
                <p>
                This policy may be updated periodically. Continued use of the service
                constitutes acceptance of any changes.
                </p>
            </div>
            </div>
        ),
    },
    {
      label: 'Data Sources',
      content: (
        <div className="space-y-6">
          <div>
            <h3 className="text-xl font-semibold text-ts-text-1">Data Attribution</h3>
            <p className="text-ts-text-2 mt-1">
              This service aggregates and displays transport data from a combination of open datasets and third-party APIs.
              Data is transformed and normalised for presentation but remains the property of its respective providers.
            </p>
          </div>

          <div className="overflow-hidden rounded-lg border border-ts-border bg-ts-surface">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-ts-surface-2 border-b border-ts-border">
                  <tr>
                    <th className="px-6 py-4 font-semibold text-ts-text-1">Source</th>
                    <th className="px-6 py-4 font-semibold text-ts-text-1">Usage & Attribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ts-border">
                  {dataSources.map((item, idx) => (
                    <tr key={idx} className="transition-colors hover:bg-ts-surface-2">
                      <td className="px-6 py-4 font-medium text-ts-text-1 whitespace-nowrap align-top">
                        {item.source}
                      </td>
                      <td className="px-6 py-4 text-ts-text-2 leading-relaxed">
                        <p>{item.desc}</p>
                        {item.license && (
                          <div className="mt-3 pt-3 border-t border-ts-border-soft text-xs text-ts-text-3">
                            {item.link ? (
                              <a
                                href={item.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-ts-accent hover:underline decoration-ts-accent underline-offset-2"
                              >
                                {item.license}
                              </a>
                            ) : (
                              <span>{item.license}</span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Critical legal clarification */}
          <div className="text-xs text-ts-text-3 space-y-2">
            <p>
              OpenStreetMap data is © OpenStreetMap contributors and made available under the Open Database License (ODbL).
              Any derived data or visualisations are subject to the same licence requirements where applicable.
            </p>
            <p>
              Rail data is ultimately sourced from Network Rail and National Rail Enquiries via third-party providers.
            </p>
            <p>
              This application is not affiliated with, endorsed by, or officially connected to any of the data providers listed above.
            </p>
            <p>
              Data may be delayed, incomplete or inaccurate. This service is provided for informational purposes only.
            </p>
          </div>
        </div>
      ),
    },
    {
        label: 'Contacts',
        content: (
            <div className="space-y-6">
            {/* Header */}
            <div>
                <h3 className="text-xl font-semibold text-ts-text-1">Contact</h3>
                <p className="text-ts-text-2 mt-1">
                Need help, found an issue, or have a question? Reach out below.
                </p>
            </div>

            {/* Contact Methods */}
            <div className="grid gap-4 sm:grid-cols-2">
                
                {/* Email Card */}
                <a
                href="mailto:support@transportstatistics.com"
                className="group rounded-xl border border-ts-border bg-ts-surface p-5 transition-all hover:bg-ts-surface-2 hover:border-ts-accent"
                >
                <div className="flex items-center justify-between">
                    <div>
                    <p className="text-sm text-ts-text-2">Email</p>
                    <p className="text-ts-text-1 font-medium mt-1">
                        support@transportstatistics.com
                    </p>
                    </div>

                    <div className="text-ts-text-3 group-hover:text-ts-accent transition-colors">
                    →
                    </div>
                </div>

                <p className="text-xs text-ts-text-3 mt-3">
                    Best for support and general enquiries.
                </p>
                </a>

                {/* Discord Card */}
                <a
                href="https://discord.gg/RvZZkj4GGm"
                target="_blank"
                rel="noopener noreferrer"
                className="group rounded-xl border border-ts-border bg-ts-surface p-5 transition-all hover:bg-ts-surface-2 hover:border-ts-accent"
                >
                <div className="flex items-center justify-between">
                    <div>
                    <p className="text-sm text-ts-text-2">Discord</p>
                    <p className="text-ts-text-1 font-medium mt-1">
                        Join the community
                    </p>
                    </div>

                    <div className="text-ts-text-3 group-hover:text-ts-accent transition-colors">
                    →
                    </div>
                </div>

                <p className="text-xs text-ts-text-3 mt-3">
                    Real-time updates, bug reports, discussions, and community support.
                </p>
                </a>
            </div>

            {/* Extra clarity */}
            <div className="text-xs text-ts-text-3">
                <p>
                We aim to respond to emails as soon as possible. For faster responses and live discussion, Discord is recommended.
                </p>
            </div>
            </div>
        ),
        }
  ];

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Tabs tabs={tabData} />
    </div>
  );
}