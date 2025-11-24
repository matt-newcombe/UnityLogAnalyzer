## Script compilation

Script compilation involves multiple messages in the log file, a typical structure will look like this:

2025-11-19T16:29:51.034Z|0x1f2a8a080|[ScriptCompilation] Requested script compilation because: Assembly Definition File(s) changed
...
Rebuilding DAG because FileSignature timestamp changed: Library/Bee/900b0aEDbg-inputdata.json
*** Tundra requires additional run (1.49 seconds), 7 items updated, 2706 evaluated
Starting: /Applications/Unity/Hub/Editor/6000.2.7f2/Unity.app/Contents/Tools/netcorerun/netcorerun "/Applications/Unity/Hub/Editor/6000.2.7f2/Unity.app/Contents/Tools/BuildPipeline/ScriptCompilationBuildProgram.exe" "Library/Bee/900b0aEDbg.dag.json" "Library/Bee/900b0aEDbg-inputdata.json" "Library/Bee/buildprogram0.traceevents"
WorkingDir: /Users/matt.newcombe/work/2025/panda-client
...
3988/3983  0s] CopyFiles Library/ScriptAssemblies/Assembly-CSharp.dll
*** Tundra build success (13.04 seconds), 246 items updated, 3983 evaluated
Assets/Plugins/PTTech/PTPoolmanager/Runtime/GlobalPoolMaxInstancesConfig.cs(63,17): warning CS0618: ...
...
2025-11-19T16:30:16.108Z|0x1f2a8a080|AssetDatabase: script compilation time: 25.074384s

I'm unsure what Tundra refers to exactly, perhaps some c++ compilation side, as I see bee get mentioned sometimes, but maybe it's around dll's
The main point is that this is neatly wrapped by script compilaton messages starting and finishing. But not all compilation looks like that, sometimes tundra compile will happen without any script precurosur:


## Cache Server Download Blocks
Cache server download blocks appear by default in the following way:

2025-11-19T16:30:56.181Z|0x1f2a8a080|Querying for cacheable assets in Cache Server:
2025-11-19T16:30:56.181Z|0x1f2a8a080|	4043d247657093b4fbf759ab14724fd7:Assets/PTGame/Art/UI/Sprites/CoreGame/PortraitBars/_Legacy/ag_curve_fortify_bar_holder.png
2025-11-19T16:30:56.181Z|0x1f2a8a080|	f02584fae5574894ea3eb723eb0e4c45:Assets/PTGame/Art/UI/Sprites/CoreGame/PortraitBars/_Legacy/ag_empty_health_bar.png
2025-11-19T16:30:56.181Z|0x1f2a8a080|	b957928abd3464291b04c96c4c5c04b3:Assets/PTGame/Art/SplashScreens/D1_SplashScreen01_Mobile.png
2025-11-19T16:30:56.181Z|0x1f2a8a080|	0ba74e6e2df5d8f418d32f949786151b:Assets/PTGame/Art/UI/Sprites/CoreGame/PortraitBars/_Legacy/ag_empty_speed_bar.png
2025-11-19T16:30:56.181Z|0x1f2a8a080|	7d0948b4da0c14cd2a870827d8119764:Assets/PTGame/Art/UI/Sprites/FTUE_Sprites/talkinghead_Otis_Taunt_Icon_l.png
2025-11-19T16:30:56.242Z|0x17ac1f000|Artifact(content hash=840fc928246663e4ff24ec61fe6f729a) downloaded for 'Assets/PTGame/Art/UI/Sprites/CoreGame/PortraitBars/_Legacy/ag_empty_health_bar.png'
2025-11-19T16:30:56.243Z|0x17ac1f000|Artifact(content hash=482691619df3195ec0aa67cebe4d0d86) downloaded for 'Assets/PTGame/Art/UI/Sprites/CoreGame/PortraitBars/_Legacy/ag_empty_speed_bar.png'

The cache server block appears to be kicked off by the Querying for cacheable assets in Cache Server line
2025-11-19T16:30:56.181Z|0x1f2a8a080|Querying for cacheable assets in Cache Server:

The assets it wants to check for are the next set of indented lines
2025-11-19T16:30:56.181Z|0x1f2a8a080|	4043d247657093b4fbf759ab14724fd7:Assets/PTGame/Art/UI/Sprites/CoreGame/PortraitBars/_Legacy/ag_curve_fortify_bar_holder.png
2025-11-19T16:30:56.181Z|0x1f2a8a080|	f02584fae5574894ea3eb723eb0e4c45:Assets/PTGame/Art/UI/Sprites/CoreGame/PortraitBars/_Legacy/ag_empty_health_bar.png
2025-11-19T16:30:56.181Z|0x1f2a8a080|	b957928abd3464291b04c96c4c5c04b3:Assets/PTGame/Art/SplashScreens/D1_SplashScreen01_Mobile.png
2025-11-19T16:30:56.181Z|0x1f2a8a080|	0ba74e6e2df5d8f418d32f949786151b:Assets/PTGame/Art/UI/Sprites/CoreGame/PortraitBars/_Legacy/ag_empty_speed_bar.png
2025-11-19T16:30:56.181Z|0x1f2a8a080|	7d0948b4da0c14cd2a870827d8119764:Assets/PTGame/Art/UI/Sprites/FTUE_Sprites/talkinghead_Otis_Taunt_Icon_l.png

And then there are lines which have resolved the requests
2025-11-19T16:30:56.242Z|0x17ac1f000|Artifact(content hash=840fc928246663e4ff24ec61fe6f729a) downloaded for 'Assets/PTGame/Art/UI/Sprites/CoreGame/PortraitBars/_Legacy/ag_empty_health_bar.png'

That line appears when the file is in the cache server, and downloads for the import succesfully.

There are multiple other scenarios the parser needs to handle

1. The file isn't in the cache server, and shouldn't be
In this scenario, we will just see lines that directly import the file, e.g.
2025-11-19T16:30:51.293Z|0x1f2a8a080|Start importing Assets/PTGame/UIScreens/PvPBlitzSavedSquad/PvPBlitzSavedSquadUIScene.unity using Guid(b6f6cb3aa15f5cc48ba7e1f64a86c8ca) (DefaultImporter) -> (artifact id: '6c28c47d24fc27f03e57a32245b63d79') in 0.814914458 seconds

and we should add this as an asset import entry as per usual

2. The file isn't in the cache server, and should be imported as normal and then uploaded
These will be tail ended with an uploaded message, e.g.
2025-11-19T16:31:43.125Z|0x17ac1f000|Artifact(artifact id=ac462f330428ac6952cdb6145199f8b0, static dependencies=3587ae9232e719267c01d5e98c8493fc, content hash=f92f5acec169c03b1f03251234bb1c2b, guid=7d0948b4da0c14cd2a870827d8119764, path=Assets/PTGame/Art/UI/Sprites/FTUE_Sprites/talkinghead_Otis_Taunt_Icon_l.png) uploaded to cacheserver

But the importing can get complicated and breaks the line flow quite significantly, for example this one:

2025-11-19T16:30:56.181Z|0x1f2a8a080|Querying for cacheable assets in Cache Server:
2025-11-19T16:30:56.181Z|0x1f2a8a080|	4043d247657093b4fbf759ab14724fd7:Assets/PTGame/Art/UI/Sprites/CoreGame/PortraitBars/_Legacy/ag_curve_fortify_bar_holder.png
2025-11-19T16:30:56.181Z|0x1f2a8a080|	f02584fae5574894ea3eb723eb0e4c45:Assets/PTGame/Art/UI/Sprites/CoreGame/PortraitBars/_Legacy/ag_empty_health_bar.png
2025-11-19T16:30:56.181Z|0x1f2a8a080|	b957928abd3464291b04c96c4c5c04b3:Assets/PTGame/Art/SplashScreens/D1_SplashScreen01_Mobile.png
2025-11-19T16:30:56.181Z|0x1f2a8a080|	0ba74e6e2df5d8f418d32f949786151b:Assets/PTGame/Art/UI/Sprites/CoreGame/PortraitBars/_Legacy/ag_empty_speed_bar.png
2025-11-19T16:30:56.181Z|0x1f2a8a080|	7d0948b4da0c14cd2a870827d8119764:Assets/PTGame/Art/UI/Sprites/FTUE_Sprites/talkinghead_Otis_Taunt_Icon_l.png
2025-11-19T16:30:56.242Z|0x17ac1f000|Artifact(content hash=840fc928246663e4ff24ec61fe6f729a) downloaded for 'Assets/PTGame/Art/UI/Sprites/CoreGame/PortraitBars/_Legacy/ag_empty_health_bar.png'
2025-11-19T16:30:56.243Z|0x17ac1f000|Artifact(content hash=482691619df3195ec0aa67cebe4d0d86) downloaded for 'Assets/PTGame/Art/UI/Sprites/CoreGame/PortraitBars/_Legacy/ag_empty_speed_bar.png'
2025-11-19T16:30:56.268Z|0x17ac1f000|Artifact(content hash=3a7f347d679c246adff9b7a84ff00a4e) downloaded for 'Assets/PTGame/Art/UI/Sprites/CoreGame/PortraitBars/_Legacy/ag_curve_fortify_bar_holder.png'
2025-11-19T16:30:56.269Z|0x17ac1f000|Starting new worker id: 0 with log in 
Starting new worker id: 1 with log in 
Worker ready: AssetImportWorker1 1
Worker ready: AssetImportWorker0 0
[Worker1] Start importing Assets/PTGame/Art/UI/Sprites/FTUE_Sprites/talkinghead_Otis_Taunt_Icon_l.png using Guid(7d0948b4da0c14cd2a870827d8119764) 
[Worker1] (TextureImporter)
[Worker0] Start importing Assets/PTGame/Art/SplashScreens/D1_SplashScreen01_Mobile.png using Guid(b957928abd3464291b04c96c4c5c04b3) 
[Worker0] (TextureImporter)
[Worker1]  -> (artifact id: 'ac462f330428ac6952cdb6145199f8b0') in 2.789259125 seconds
[Worker0]  -> (artifact id: '2abccad5ed5673b4c2727add12566d49') in 2.883279167 seconds
Querying for cacheable assets in Cache Server:
2025-11-19T16:31:42.827Z|0x1f2a8a080|	bb5d4fb2078ea174a9f7f72b533004c4:Assets/PTGame/Art/VFX/Groups/Arena/Common/Lights_RingSpotLights/Timelines/Lightshow_ArenaCommon_Lights_RingSpotLights_SlowRotation.playable
2025-11-19T16:31:43.125Z|0x17ac1f000|Artifact(artifact id=ac462f330428ac6952cdb6145199f8b0, static dependencies=3587ae9232e719267c01d5e98c8493fc, content hash=f92f5acec169c03b1f03251234bb1c2b, guid=7d0948b4da0c14cd2a870827d8119764, path=Assets/PTGame/Art/UI/Sprites/FTUE_Sprites/talkinghead_Otis_Taunt_Icon_l.png) uploaded to cacheserver
2025-11-19T16:31:43.161Z|0x17ac1f000|Artifact(content hash=95a4041b6c7cb6cfdcc4a80f1e1d4844) downloaded for 'Assets/PTGame/Art/VFX/Groups/Arena/Common/Lights_RingSpotLights/Timelines/Lightshow_ArenaCommon_Lights_RingSpotLights_SlowRotation.playable'
2025-11-19T16:31:43.163Z|0x1f2a8a080|Querying for cacheable assets in Cache Server:
2025-11-19T16:31:43.163Z|0x1f2a8a080|	400348ec6ac3531489c28887e3384333:Assets/PTGame/Art/Animations/F_RaquelGonzalez_CharacterDetails_Fidget02_MX_Slot1_Char1.fbx
2025-11-19T16:31:43.163Z|0x1f2a8a080|	133167203ef038947a12b2d0a9ab8353:Assets/PTGame/Art/Animations/F_RaquelGonzalez_CharacterDetails_Fidget04_MX_Slot1_Char1.fbx
2025-11-19T16:31:43.163Z|0x1f2a8a080|	438b388b3813d414bab3c52812619a81:Assets/PTGame/Art/Animations/F_RaquelGonzalez_CharacterDetails_TeamIdle_MX_Slot1_Char1.fbx
2025-11-19T16:31:43.163Z|0x1f2a8a080|	e6f1550ebf9de2f4b9ed89b62a98309f:Assets/PTGame/Art/Animations/F_RaquelGonzalez_CharacterDetails_Idle_MX_Slot1_Char1.fbx
2025-11-19T16:31:43.163Z|0x1f2a8a080|	78aa7481e597e3147960639ad6e4f0ae:Assets/PTGame/Art/Animations/F_RaquelGonzalez_CharacterDetails_LevelUp_MX_Slot1_Char1.fbx
2025-11-19T16:31:43.163Z|0x1f2a8a080|	88db331329e835d4cbf9f5ec53ba2904:Assets/PTGame/Art/Animations/F_RaquelGonzalez_CharacterDetails_TeamIdleMirror_MX_Slot1_Char1.fbx
2025-11-19T16:31:43.163Z|0x1f2a8a080|	bf83e5013c70aef428c8d8a66ef4d66e:Assets/PTGame/Art/Animations/F_RaquelGonzalez_CharacterDetails_Reaction_MX_Slot1_Char1.fbx
2025-11-19T16:31:43.163Z|0x1f2a8a080|	ef766f0fc11f8cf45bae96564e20797a:Assets/PTGame/Art/Animations/F_RaquelGonzalez_CharacterDetails_Ascension_MX_Slot1_Char1.fbx
2025-11-19T16:31:43.936Z|0x17ac1f000|Artifact(artifact id=2abccad5ed5673b4c2727add12566d49, static dependencies=21d9f741ad69882fc8a5914b8abca908, content hash=9e9b65657024461884aca6d3aa005ca0, guid=b957928abd3464291b04c96c4c5c04b3, path=Assets/PTGame/Art/SplashScreens/D1_SplashScreen01_Mobile.png) uploaded to cacheserver
2025-11-19T16:31:46.350Z|0x17ac1f000|Artifact(content hash=418576fec137d46e3826cd53226c7504) downloaded for 'Assets/PTGame/Art/Animations/F_RaquelGonzalez_CharacterDetails_Fidget02_MX_Slot1_Char1.fbx'
2025-11-19T16:31:46.591Z|0x17ac1f000|Artifact(content hash=d4001b21c5264474a9904ddac27102a6) downloaded for 'Assets/PTGame/Art/Animations/F_RaquelGonzalez_CharacterDetails_Fidget04_MX_Slot1_Char1.fbx'

Here two images were not found on the cache server, it spun up new worker threads to process them, and after doing the full import, did two things
1. started uploading them (the uploaded succesfull messages are interspesed with the regular parsing that starts happening again, e.g. the new query line)
and 
2. continued execution of the rest of the importing.

This is pretty difficult to parse properly because the log format changes, and we're also now anticipating conclusion messages occuring in the middle of other operations, and can only attribute this based on the asset name linking it back to the original query request

3. The file is in the cache server
Nice and easy and we can just link it based on the downloaded messages
