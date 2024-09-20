using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using System;
using System.Linq;
using System.Net.Mail;
using System.Text.RegularExpressions;

namespace PostReplyCreationPlugin
{
    public class PostPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            ITracingService tracingService = (ITracingService)serviceProvider.GetService(typeof(ITracingService));
            IOrganizationServiceFactory serviceFactory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            IOrganizationService service = serviceFactory.CreateOrganizationService(null);

            tracingService.Trace("PostPlugin execution started.");

            // Get the context from the service provider
            IPluginExecutionContext context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));

            // Ensure that the entity is of type ats_post or ats_reply
            if (context.InputParameters.Contains("Target") && context.InputParameters["Target"] is Entity entity)
            {
                if (entity.LogicalName != "ats_post" && entity.LogicalName != "ats_reply")
                {
                    tracingService.Trace("Entity is neither ats_post nor ats_reply. Exiting plugin.");
                    return;
                }

                tracingService.Trace($"Processing {entity.LogicalName} entity.");

                // Get the content of the post or reply
                string content = entity.GetAttributeValue<string>("ats_content");
                tracingService.Trace($"Content: {content}");

                // Determine if the entity is a reply and needs to fetch Job Seeker ID from the related post
                Guid? jobSeekerId = null;

                if (entity.LogicalName == "ats_reply")
                {
                    // Get the related post ID
                    var postReference = entity.GetAttributeValue<EntityReference>("ats_postid");
                    if (postReference != null)
                    {
                        var postId = postReference.Id;
                        tracingService.Trace($"Fetching Job Seeker ID from related post: {postId}");

                        // Retrieve the related post to get the Job Seeker ID
                        var post = service.Retrieve("ats_post", postId, new ColumnSet("ats_jobseekerid"));
                        jobSeekerId = post.GetAttributeValue<EntityReference>("ats_jobseekerid")?.Id;
                    }
                }
                else
                {
                    // For posts, directly get the Job Seeker ID
                    jobSeekerId = entity.GetAttributeValue<EntityReference>("ats_jobseekerid")?.Id;
                }

                if (jobSeekerId == null)
                {
                    tracingService.Trace("No Job Seeker ID found. Exiting plugin.");
                    return;
                }

                tracingService.Trace($"Job Seeker ID found: {jobSeekerId}");

                // Construct the URL to the job seeker record
                string baseUrl = "https://kasadara-ats.crm.dynamics.com";
                string appId = "eccc21a4-3d70-ee11-9ae7-0022482b6eda"; // Replace with the correct App ID
                string jobSeekerUrl = $"{baseUrl}/main.aspx?appid={appId}&pagetype=entityrecord&etn=ats_job_seeker&id={jobSeekerId}";

                tracingService.Trace($"Job Seeker URL: {jobSeekerUrl}");

                // Extract tagged usernames from the content
                var taggedUsernames = ExtractTaggedUsernames(content);
                tracingService.Trace($"Tagged usernames: {string.Join(", ", taggedUsernames)}");

                if (taggedUsernames.Length == 0)
                {
                    tracingService.Trace("No tagged usernames found. Exiting plugin.");
                }

                foreach (var username in taggedUsernames)
                {
                    // Fetch the email address of the user
                    tracingService.Trace($"Fetching email for user: {username}");
                    var email = FetchUserEmail(service, username, tracingService);
                    if (email != null)
                    {
                        tracingService.Trace($"Sending email to: {email}");

                        // Create the HTML email body
                        string emailBody = $@"
                            <p>You were tagged in a post/reply: {content}</p>
                            <p><a href='{jobSeekerUrl}'>Click here</a> to view the related Job Seeker.</p>";

                        // Send email using the MailHelper with the HTML body
                        MailHelper.Send(service, email, "You were tagged in a post/reply", emailBody, true);
                    }
                    else
                    {
                        tracingService.Trace($"No email found for user: {username}");
                    }
                }
            }

            tracingService.Trace("PostPlugin execution finished.");
        }

        private string[] ExtractTaggedUsernames(string content)
        {
            // Adjusted regex to allow spaces and other characters in usernames
           
            var regex =new Regex(@"@([^\s,@]+(?:\s[^\s,@]+)*)(?=[,\s]|$)");


            //var regex = new Regex(@"@([^\s@]+(?:\s[^\s@]+)*)");

            var matches = regex.Matches(content);
            return matches.Cast<Match>().Select(m => m.Groups[1].Value).ToArray();
        }

        private string FetchUserEmail(IOrganizationService service, string username, ITracingService tracingService)
        {
            var query = new QueryExpression("systemuser")
            {
                ColumnSet = new ColumnSet("internalemailaddress"),
                Criteria = new FilterExpression
                {
                    Conditions =
                    {
                        new ConditionExpression("fullname", ConditionOperator.Equal, username)
                    }
                }
            };

            var result = service.RetrieveMultiple(query);
            var user = result.Entities.FirstOrDefault();
            var email = user?.GetAttributeValue<string>("internalemailaddress");

            if (email == null)
            {
                tracingService.Trace($"No email found for username: {username}");
            }
            else
            {
                tracingService.Trace($"Email for {username} is {email}");
            }

            return email;
        }
    }
}
