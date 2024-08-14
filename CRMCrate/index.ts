import { IInputs, IOutputs } from "./generated/ManifestTypes";

export class Postings implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private _container: HTMLDivElement;
    private _context: ComponentFramework.Context<IInputs>;
    private _notifyOutputChanged: () => void;
    private _userList: any[] = []; // Store fetched users
    private _activeTextArea: HTMLTextAreaElement | null = null; // Track active textarea

    constructor() {
        this._container = document.createElement("div");
        this._container.innerHTML = `
<div class="threaded-conversation">
    <textarea class="new-post-content" placeholder="Write your post here..."></textarea>
    <div class="user-suggestions" style="display: none;"></div>
    <button class="new-post-button">Post</button>
    <div class="posts">
        <!-- Posts will be dynamically inserted here -->
    </div>
</div>
        `;
    }

    public async init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void, state: ComponentFramework.Dictionary, container: HTMLDivElement): Promise<void> {
        this._context = context;
        this._notifyOutputChanged = notifyOutputChanged;

        container.appendChild(this._container);
        this.attachEventListeners();

        // Retrieve existing posts and replies
        await this.retrieveAndDisplayPosts();

        // Fetch users for tagging
        await this.fetchUsers();
    }

    private attachEventListeners(): void {
        const postButton = this._container.querySelector('.new-post-button') as HTMLButtonElement;
        postButton.addEventListener('click', () => this.handlePostButtonClick());

        const postContentInput = this._container.querySelector('.new-post-content') as HTMLTextAreaElement;
        this.attachInputEventListener(postContentInput);

        // Add event listeners for existing replies
        const replyButtons = this._container.querySelectorAll('.reply-button');
        replyButtons.forEach(replyButton => {
            replyButton.addEventListener('click', async () => {
                const parentElement = replyButton.parentElement;
                if (parentElement) {
                    const replyContentInput = parentElement.querySelector('.new-reply-content') as HTMLTextAreaElement;
                    this.attachInputEventListener(replyContentInput);
                }
            });
        });
    }

    private attachReplyEventListener(replyButton: HTMLButtonElement): void {
        replyButton.addEventListener('click', async () => {
            const parentElement = replyButton.parentElement;
            if (parentElement) {
                const replyContentInput = parentElement.querySelector('.new-reply-content') as HTMLTextAreaElement;
                this.attachInputEventListener(replyContentInput);

                const replyContent = replyContentInput.value.trim();
                if (replyContent) {
                    const postId = (parentElement as HTMLDivElement).dataset.postId; // Retrieve the postId
                    if (postId) {
                        try {
                            const replyId = await this.storeReplyInDataverse(postId, replyContent);
                            if (replyId) {
                                const reply = document.createElement('div');
                                reply.className = 'reply';
                                reply.dataset.replyId = replyId; // Store the replyId in the dataset
                                reply.innerHTML = `
<div class="reply-author">${this._context.userSettings.userName}</div>
<div class="reply-content">${replyContent}</div>
<div class="reply-modified-on">${this.formatDate(new Date().toISOString())}</div>
                                `;
                                const repliesContainer = parentElement.querySelector('.replies');
                                if (repliesContainer) {
                                    repliesContainer.appendChild(reply);
                                    replyContentInput.value = ''; // Clear the input field
                                }
                            }
                        } catch (error) {
                            console.error("Error storing reply:", error);
                        }
                    }
                } else {
                    alert("Reply content cannot be empty");
                }
            }
        });
    }

    private attachInputEventListener(textarea: HTMLTextAreaElement): void {
        textarea.addEventListener('input', () => this.handleInput(textarea));
        textarea.addEventListener('focus', () => this._activeTextArea = textarea); // Track the active textarea
    }

    private async handlePostButtonClick(): Promise<void> {
        const postContentInput = this._container.querySelector('.new-post-content') as HTMLTextAreaElement;
        const postContent = postContentInput.value.trim();

        if (postContent) {
            // Store the post in Dataverse
            const postId = await this.storePostInDataverse(postContent);

            if (postId) {
                const postsContainer = this._container.querySelector('.posts') as HTMLDivElement;
                const newPost = document.createElement('div');
                newPost.className = 'post';
                newPost.dataset.postId = postId; // Store the postId in the dataset
                newPost.innerHTML = `
<div class="post-author">${this._context.userSettings.userName}</div>
<div class="post-content">${postContent}</div>
<div class="post-modified-on">${this.formatDate(new Date().toISOString())}</div>
<div class="replies">
    <!-- Replies will be dynamically inserted here -->
</div>
<textarea class="new-reply-content" placeholder="Write your reply here..."></textarea>
<div class="user-suggestions" style="display: none;"></div>
<button class="reply-button">Reply</button>
                `;
                postsContainer.prepend(newPost);
                this.attachReplyEventListener(newPost.querySelector('.reply-button') as HTMLButtonElement);
                this.attachInputEventListener(newPost.querySelector('.new-reply-content') as HTMLTextAreaElement);
                postContentInput.value = ''; // Clear the input field
            }
        } else {
            alert("Post content cannot be empty");
        }
    }

    private async storePostInDataverse(content: string): Promise<string | null> {
        const jobSeekerId = this._context.parameters.accountId?.raw;
        if (!jobSeekerId || jobSeekerId.length === 0) {
            console.error("No valid jobSeekerId provided");
            return null;
        }

        const post = {
            "ats_content": content,
            "ats_jobseekerid@odata.bind": `/ats_job_seekers(${jobSeekerId})` // Updated URL path for the job seeker
        };

        try {
            const result = await this._context.webAPI.createRecord("ats_post", post); // Updated entity name
            return result.id;
        } catch (error) {
            console.error("Error creating post:", error);
            return null;
        }
    }

    private async storeReplyInDataverse(postId: string, content: string): Promise<string | null> {
        const reply = {
            "ats_Postid@odata.bind": `/ats_posts(${postId})`, // Updated URL path for the post
            "ats_content": content
        };

        try {
            const result = await this._context.webAPI.createRecord("ats_reply", reply); // Updated entity name
            return result.id;
        } catch (error) {
            console.error("Error creating reply:", error);
            return null;
        }
    }

    private async retrieveAndDisplayPosts(): Promise<void> {
        const jobSeekerId = this._context.parameters.accountId.raw;

        try {
            const posts = await this._context.webAPI.retrieveMultipleRecords("ats_post", `?$filter=_ats_jobseekerid_value eq ${jobSeekerId}&$select=ats_postid,ats_content,_createdby_value,modifiedon`);
            for (const post of posts.entities.sort((a,b) => b.modifiedon - a.modifiedon)) {
                const userId = post._createdby_value; // Get the user ID of the post creator
                const user = await this._context.webAPI.retrieveRecord("systemuser", userId, "?$select=fullname"); // Retrieve the user's name
                this.displayPost(post, user.fullname, post.modifiedon);

                const replies = await this._context.webAPI.retrieveMultipleRecords("ats_reply", `?$filter=_ats_postid_value eq ${post.ats_postid}&$select=ats_replyid,ats_content,_createdby_value,modifiedon`);
                for (const reply of replies.entities) {
                    const replyUserId = reply._createdby_value; // Get the user ID of the reply creator
                    const replyUser = await this._context.webAPI.retrieveRecord("systemuser", replyUserId, "?$select=fullname"); // Retrieve the user's name
                    this.displayReply(post.ats_postid, reply, replyUser.fullname, reply.modifiedon);
                }
            }
        } catch (error) {
            console.error("Error retrieving posts or replies:", error);
        }
    }

    private displayPost(post: any, userName: string, modifiedOn: string): void {
        const postsContainer = this._container.querySelector('.posts') as HTMLDivElement;
        const newPost = document.createElement('div');
        newPost.className = 'post';
        newPost.dataset.postId = post.ats_postid; // Updated schema name
        newPost.innerHTML = `
<div class="post-author">${userName}</div>
<div class="post-content">${post.ats_content}</div>
<div class="post-modified-on">${this.formatDate(modifiedOn)}</div>
<div class="replies">
    <!-- Replies will be dynamically inserted here -->
</div>
<textarea class="new-reply-content" placeholder="Write your reply here..."></textarea>
<div class="user-suggestions" style="display: none;"></div>
<button class="reply-button">Reply</button>
        `;
        postsContainer.prepend(newPost);
        this.attachReplyEventListener(newPost.querySelector('.reply-button') as HTMLButtonElement);
        this.attachInputEventListener(newPost.querySelector('.new-reply-content') as HTMLTextAreaElement);
    }

    private displayReply(postId: string, reply: any, userName: string, modifiedOn: string): void {
        const postElement = this._container.querySelector(`.post[data-post-id="${postId}"]`) as HTMLDivElement;
        if (postElement) {
            const repliesContainer = postElement.querySelector('.replies') as HTMLDivElement;
            const newReply = document.createElement('div');
            newReply.className = 'reply';
            newReply.dataset.replyId = reply.ats_replyid; // Updated schema name
            newReply.innerHTML = `
<div class="reply-author">${userName}</div>
<div class="reply-content">${reply.ats_content}</div>
<div class="reply-modified-on">${this.formatDate(modifiedOn)}</div>
            `;
            repliesContainer.appendChild(newReply);
        }
    }

    private formatDate(dateString: string): string {
        const date = new Date(dateString);
        return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
    }

    private async fetchUsers(): Promise<void> {
        try {
            const users = await this._context.webAPI.retrieveMultipleRecords("systemuser", "?$select=systemuserid,fullname");
            this._userList = users.entities;
        } catch (error) {
            console.error("Error fetching users:", error);
        }
    }

    private handleInput(textarea: HTMLTextAreaElement): void {
        const value = textarea.value;
        const cursorPosition = textarea.selectionStart;
        const atIndex = value.lastIndexOf('@', cursorPosition - 1);

        if (atIndex !== -1) {
            const searchTerm = value.substring(atIndex + 1, cursorPosition);
            this.showUserSuggestions(searchTerm, textarea, atIndex);
        } else {
            this.hideUserSuggestions(textarea.parentElement);
        }
    }

    private showUserSuggestions(searchTerm: string, textarea: HTMLTextAreaElement, atIndex: number): void {
        const suggestionsContainer = (textarea.parentElement as any).querySelector('.user-suggestions') as HTMLDivElement;
        suggestionsContainer.innerHTML = '';

        if (searchTerm) {
            const filteredUsers = this._userList.filter(user =>
                user.fullname.toLowerCase().includes(searchTerm.toLowerCase())
            );

            filteredUsers.forEach(user => {
                const suggestionItem = document.createElement('div');
                suggestionItem.className = 'suggestion-item';
                suggestionItem.textContent = user.fullname;
                suggestionItem.addEventListener('click', () => this.handleUserSelection(user.fullname, textarea, atIndex));
                suggestionsContainer.appendChild(suggestionItem);
            });

            const textareaRect = textarea.getBoundingClientRect();
            suggestionsContainer.style.display = 'block';
            suggestionsContainer.style.left = `${textareaRect.left}px`;
            suggestionsContainer.style.top = `${textareaRect.bottom}px`;
        } else {
            this.hideUserSuggestions(textarea.parentElement);
        }
    }

    private hideUserSuggestions(container:HTMLElement | null): void {
        if(!container) return;
        const suggestionsContainer = container.querySelector('.user-suggestions') as HTMLDivElement;
        suggestionsContainer.style.display = 'none';
    }

    private handleUserSelection(userName: string, textarea: HTMLTextAreaElement, atIndex: number): void {
        const value = textarea.value;
        const cursorPosition = textarea.selectionStart;
        const beforeAt = value.substring(0, atIndex);
        const afterAt = value.substring(cursorPosition);
        const newValue = `${beforeAt}@${userName} ${afterAt}`;

        textarea.value = newValue;
        textarea.selectionStart = textarea.selectionEnd = beforeAt.length + userName.length + 2;

        this.hideUserSuggestions(textarea.parentElement);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this._context = context;
    }

    public getOutputs(): IOutputs {
        return {};
    }

    public destroy(): void {}
}