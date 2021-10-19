const app = new Vue({
  el: "#app",
  delimiters: ["${", "}"],
  data: {
    callPlaced: false,
    client: null,
    localStream: null,
    mutedAudio: false,
    mutedVideo: false,
    userOnlineChannel: null,
    onlineUsers: [],
    incomingCall: false,
    incomingCaller: "",
    agoraChannel: null,
    rtmClient: null,
    rtmChannel: null,
    users: [],
    onlineStatuses: null,
    updatedOnlineStatus: null,
    tokenData: null,
    channelName: null,
  },
  mounted() {
    this.fetchUsers();
    this.initRtmInstance();
  },

  async destroyed() {
    this.rtmChannel.leave(AUTH_USER);
    await this.rtmClient.logout();
  },

  methods: {
    async fetchUsers() {
      const { data } = await axios.get("/users");
      this.users = data;
    },

    async initRtmInstance() {
      // initialize an Agora RTM instance
      this.rtmClient = AgoraRTM.createInstance(AGORA_APP_ID, {
        enableLogUpload: false,
      });

      // RTM Channel to be used
      this.channelName = "videoCallChannel";

      // Generate the RTM token
      const { data } = await this.generateToken(this.channelName);

      this.tokenData = data;

      // Login when it mounts
      await this.rtmClient.login({
        uid: AUTH_USER,
        token: data.rtm_token,
      });
      // Log out handler

      // RTM Message Listeners
      this.rtmClient.on("MessageFromPeer", (message, peerId) => {
        console.log("MessageFromPeer");
        console.log("message: ", message);
        console.log("peerId: ", peerId);
      });

      // Display connection state changes
      this.rtmClient.on("ConnectionStateChanged", (state, reason) => {
        console.log("ConnectionStateChanged");
        console.log("state: ", state);
        console.log("reason: ", reason);
      });
      // Emitted when a Call Invitation is sent from Remote User
      this.rtmClient.on("RemoteInvitationReceived", (data) => {
        console.log("REMOTE INVITATION RECEIVED: ", data);
        this.remoteInvitation = data;
        this.incomingCall = true;
        this.incomingCaller = data.callerId;
      });

      this.rtmClient.on("LocalInvitationReceivedByPeer", (data) => {
        console.log("LOCAL INVITATION RECEIVED BY PEER");
        console.log(data);
      });

      this.rtmClient.on("LocalInvitationCanceled", (data) => {
        console.log("LOCAL INVITATION CANCELED");
        console.log(data);
      });

      this.rtmClient.on("RemoteInvitationCanceled", (data) => {
        console.log("REMOTE INVITATION CANCELED");
        console.log(data);
      });

      this.rtmClient.on("LocalInvitationAccepted", (data) => {
        console.log("LOCAL INVITATION ACCEPTED");
        console.log(data);
      });

      this.rtmClient.on("RemoteInvitationAccepted", (data) => {
        console.log("REMOTE INVITATION ACCEPTED");
        console.log(data);
      });

      this.rtmClient.on("LocalInvitationRefused", (data) => {
        console.log("LOCAL INVITATION REFUSED");
        console.log(data);
      });

      this.rtmClient.on("RemoteInvitationRefused", (data) => {
        console.log("REMOTE INVITATION REFUSED");
        console.log(data);
      });

      this.rtmClient.on("LocalInvitationFailure", (data) => {
        console.log("LOCAL INVITATION FAILURE");
        console.log(data);
      });

      this.rtmClient.on("RemoteInvitationFailure", (data) => {
        console.log("REMOTE INVITATION FAILURE");
        console.log(data);
      });

      this.rtmClient.on("PeersOnlineStatusChanged", (data) => {
        this.updatedOnlineStatus = data;
      });

      // Subscribes to the online statuses of all users apart from
      // the currently authenticated user
      this.rtmClient.subscribePeersOnlineStatus(
        this.users
          .map((user) => user.username)
          .filter((user) => user !== AUTH_USER)
      );

      // Create a channel and listen to messages
      this.rtmChannel = this.rtmClient.createChannel(this.channelName);

      // Join the RTM Channel
      this.rtmChannel.join();

      // The number of connecte
      const count = await this.rtmClient.getChannelMemberCount([
        this.channelName,
      ]);

      const members = await this.rtmChannel.getMembers();

      this.onlineStatuses = await this.rtmClient.queryPeersOnlineStatus(
        this.users
          .map((user) => user.username)
          .filter((user) => user !== AUTH_USER)
      );
      console.log(this.onlineStatuses);

      this.rtmChannel.on("ChannelMessage", (message, memberId) => {
        console.log("ChannelMessage");
        console.log("message: ", message);
        console.log("memberId: ", memberId);
      });

      this.rtmChannel.on("MemberJoined", (memberId) => {
        console.log("MemberJoined");

        // check whether user exists before you add them to the online user list
        const joiningUserIndex = this.onlineUsers.findIndex(
          (member) => member === memberId
        );
        if (joiningUserIndex < 0) {
          this.onlineUsers.push(memberId);
        }
      });

      this.rtmChannel.on("MemberLeft", (memberId) => {
        console.log("MemberLeft");
        console.log("memberId: ", memberId);
        const leavingUserIndex = this.onlineUsers.findIndex(
          (member) => member === memberId
        );
        this.onlineUsers.splice(leavingUserIndex, 1);
      });

      this.rtmChannel.on("MemberCountUpdated", (data) => {
        console.log("MemberCountUpdated");
      });
    },

    getUserOnlineStatus(username) {
      console.log(this.onlineStatuses?.[username]);
      if (this.onlineStatuses?.[username]) {
        return "Online";
      }
      return "offline";
    },

    async placeCall(calleeName) {
      // Create a channel/room name for the video call
      const videoChannelName = `${AUTH_USER}_${calleeName}`;
      // Create LocalInvitation
      this.localInvitation = this.rtmClient.createLocalInvitation(calleeName);

      // set the channelId
      this.localInvitation.channelId = videoChannelName;

      // Send call invitation
      this.localInvitation.send();

      // Generate an RTM token using the channel/room name
      const { data } = await this.generateToken(videoChannelName);

      // Initialize the agora RTM Client
      this.initializeAgora();

      // Join a room using the channel name. The callee will also join the room then accept the call
      await this.joinRoom(AGORA_APP_ID, data.token, videoChannelName);
    },

    cancelCall() {
      this.localInvitation.cancel();
    },

    async acceptCall() {
      // Generate RTC token using the channelId of the caller
      const { data } = await this.generateToken(
        this.remoteInvitation.channelId
      );

      // Initialize AgoraRTC Client
      this.initializeAgora();

      // Join the room created by the caller
      await this.joinRoom(
        AGORA_APP_ID,
        data.token,
        this.remoteInvitation.channelId
      );

      // Accept Call Invitation
      this.remoteInvitation.accept();
      this.incomingCall = false;
      this.callPlaced = true;
    },

    declineCall() {
      this.remoteInvitation.refuse();
      this.incomingCall = false;
    },

    async generateToken(channelName) {
      return await axios.post(
        "/agora-rtm/token",
        {
          channelName,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": CSRF_TOKEN,
          },
        }
      );
    },

    /**
     * Agora Events and Listeners
     */
    initializeAgora() {
      this.client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    },

    async joinRoom(appID, token, channel) {
      try {
        await this.client.join(appID, channel, token, AUTH_USER);
        this.callPlaced = true;
        this.createLocalStream();
        this.initializedAgoraListeners();
      } catch (error) {
        console.log(error);
      }
    },

    initializedAgoraListeners() {
      //   Register event listeners
      this.client.on("user-published", async (user, mediaType) => {
        await this.client.subscribe(user, mediaType);

        // If the remote user publishes a video track.
        if (mediaType === "video") {
          // Get the RemoteVideoTrack object in the AgoraRTCRemoteUser object.
          const remoteVideoTrack = user.videoTrack;
          remoteVideoTrack.play("remote-video");
        }
        // If the remote user publishes an audio track.
        if (mediaType === "audio") {
          // Get the RemoteAudioTrack object in the AgoraRTCRemoteUser object.
          const remoteAudioTrack = user.audioTrack;
          // Play the remote audio track. No need to pass any DOM element.
          remoteAudioTrack.play();
        }
      });

      this.client.on("user-unpublished", (data) => {
        console.log("USER UNPUBLISHED: ", data);
      });
    },

    async createLocalStream() {
      const [microphoneTrack, cameraTrack] =
        await AgoraRTC.createMicrophoneAndCameraTracks();
      await this.client.publish([microphoneTrack, cameraTrack]);
      cameraTrack.play("local-video");
    },

    async endCall() {
      await this.client.unpublish();
      await this.client.leave();
    },

    handleAudioToggle() {
      if (this.mutedAudio) {
        this.localStream.unmuteAudio();
        this.mutedAudio = false;
      } else {
        this.localStream.muteAudio();
        this.mutedAudio = true;
      }
    },

    handleVideoToggle() {
      if (this.mutedVideo) {
        this.localStream.unmuteVideo();
        this.mutedVideo = false;
      } else {
        this.localStream.muteVideo();
        this.mutedVideo = true;
      }
    },
  },
});
