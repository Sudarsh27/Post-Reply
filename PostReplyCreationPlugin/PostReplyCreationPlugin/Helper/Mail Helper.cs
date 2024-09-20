using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using System;
using System.Linq;
using System.Net;
using System.Net.Mail;
using System.Text;

namespace PostReplyCreationPlugin
{
    internal class MailHelper
    {
        public static void Send(IOrganizationService service, string to, string subject, string content, bool isHtml)
        {
            var log = service as ITracingService;

            QueryExpression queryExp = new QueryExpression("environmentvariabledefinition")
            {
                ColumnSet = new ColumnSet("schemaname", "defaultvalue"),
                Criteria = new FilterExpression
                {
                    Conditions =
                    {
                        new ConditionExpression("schemaname", ConditionOperator.BeginsWith, "ats_smtp")
                    }
                }
            };

            EntityCollection entityCollection = service.RetrieveMultiple(queryExp);

            // Retrieve SMTP configuration
            var smtpHost = entityCollection.Entities.FirstOrDefault(e => e.GetAttributeValue<string>("schemaname") == "ats_smtp_host")?.GetAttributeValue<string>("defaultvalue");
            var smtpPort = Int32.Parse(entityCollection.Entities.FirstOrDefault(e => e.GetAttributeValue<string>("schemaname") == "ats_smtp_port")?.GetAttributeValue<string>("defaultvalue"));
            var smtpUser = entityCollection.Entities.FirstOrDefault(e => e.GetAttributeValue<string>("schemaname") == "ats_smtp_user")?.GetAttributeValue<string>("defaultvalue");
            var smtpPwd = Encoding.UTF8.GetString(Convert.FromBase64String(entityCollection.Entities.FirstOrDefault(e => e.GetAttributeValue<string>("schemaname") == "ats_smtp_pwd")?.GetAttributeValue<string>("defaultvalue")));

            if (smtpHost == null || smtpPort == 0 || smtpUser == null || smtpPwd == null)
            {
                log?.Trace("SMTP configuration is missing.");
                return;
            }

            SmtpClient smtpClient = new SmtpClient
            {
                Host = smtpHost,
                Port = smtpPort,
                DeliveryFormat = SmtpDeliveryFormat.International,
                DeliveryMethod = SmtpDeliveryMethod.Network,
                UseDefaultCredentials = false,
                Credentials = new NetworkCredential(smtpUser, smtpPwd),
                EnableSsl = true
            };

            MailMessage message = new MailMessage
            {
                From = new MailAddress(smtpUser), // Use the SMTP user as the sender address
                Subject = $"[ATS] : {subject}",
                IsBodyHtml = true,

                Body = content
            };
            message.To.Add(to);

            smtpClient.SendCompleted += (object obj, System.ComponentModel.AsyncCompletedEventArgs e) =>
            {
                if (e.Error != null)
                {
                    log?.Trace($"Mail sending failed: {e.Error.Message}");
                }
                else
                {
                    log?.Trace("Mail sent successfully");
                }
            };

            smtpClient.Send(message);
        }
    }
}
