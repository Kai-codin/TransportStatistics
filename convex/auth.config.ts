export default {
  providers: [
    {
      domain: `https://${process.env.CLERK_HOSTNAME}/`,
      applicationID: "convex",
    },
  ],
};