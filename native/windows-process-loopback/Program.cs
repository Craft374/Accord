using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class Program
{
    private const string LoopbackDevice = "VAD\\Process_Loopback";
    private const int ClsctxAll = 23;
    private const uint AudclntStreamflagsLoopback = 0x00020000;
    private const uint AudclntStreamflagsAutoconvertpcm = 0x80000000;
    private const uint AudclntStreamflagsSrcDefaultQuality = 0x08000000;
    private const uint AudclntBufferflagsSilent = 0x00000002;
    private const int WaveFormatIeeeFloat = 3;
    private const ushort VtBlob = 65;
    private const int DefaultSampleRate = 48000;
    private const int DefaultChannels = 2;
    private static volatile bool s_stopping;

    [MTAThread]
    public static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        bool runtimeInitialized = false;

        try
        {
            runtimeInitialized = InitializeRuntime();
            if (args.Length == 0 || HasArg(args, "--help"))
            {
                WriteUsage();
                return 0;
            }

            string command = args[0].ToLowerInvariant();
            if (command == "list")
            {
                int excludePid = GetIntArg(args, "--exclude-pid", -1);
                WriteSessionList(excludePid);
                return 0;
            }

            if (command == "capture")
            {
                int pid = GetIntArg(args, "--pid", -1);
                int sampleRate = GetIntArg(args, "--sample-rate", DefaultSampleRate);
                int channels = GetIntArg(args, "--channels", DefaultChannels);
                if (pid <= 0) throw new ArgumentException("capture requires --pid.");
                if (channels < 1 || channels > 2) throw new ArgumentException("--channels must be 1 or 2.");
                CaptureProcessLoopback(pid, sampleRate, channels);
                return 0;
            }

            if (command == "dedupe")
            {
                WriteDedupedPids(GetPidListArg(args, "--pids"));
                return 0;
            }

            throw new ArgumentException("Unknown command: " + args[0]);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("{\"ok\":false,\"error\":\"" + JsonEscape(ex.Message) + "\"}");
            return 1;
        }
        finally
        {
            if (runtimeInitialized) RoUninitialize();
        }
    }

    private static void WriteUsage()
    {
        Console.WriteLine("AccordProcessLoopback list [--exclude-pid PID]");
        Console.WriteLine("AccordProcessLoopback capture --pid PID [--sample-rate 48000] [--channels 2]");
    }

    private static bool HasArg(string[] args, string name)
    {
        for (int i = 0; i < args.Length; i += 1)
        {
            if (String.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static int GetIntArg(string[] args, string name, int fallback)
    {
        for (int i = 0; i < args.Length - 1; i += 1)
        {
            if (!String.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) continue;
            int value;
            return Int32.TryParse(args[i + 1], out value) ? value : fallback;
        }
        return fallback;
    }

    private static void WriteSessionList(int excludePid)
    {
        List<AudioSessionItem> items = ListAudioSessions(excludePid);
        StringBuilder json = new StringBuilder();
        json.Append("{\"ok\":true,\"items\":[");
        for (int i = 0; i < items.Count; i += 1)
        {
            if (i > 0) json.Append(',');
            AudioSessionItem item = items[i];
            json.Append("{\"pid\":").Append(item.Pid);
            json.Append(",\"pids\":[");
            for (int p = 0; p < item.Pids.Count; p += 1)
            {
                if (p > 0) json.Append(',');
                json.Append(item.Pids[p]);
            }
            json.Append(']');
            json.Append(",\"name\":\"").Append(JsonEscape(item.Name)).Append('"');
            json.Append(",\"title\":\"").Append(JsonEscape(item.Title)).Append('"');
            json.Append(",\"path\":\"").Append(JsonEscape(item.Path)).Append('"');
            json.Append(",\"appId\":\"").Append(JsonEscape(item.AppId)).Append('"');
            json.Append(",\"packageFamily\":\"").Append(JsonEscape(item.PackageFamilyName)).Append('"');
            json.Append(",\"state\":\"").Append(JsonEscape(item.State)).Append("\"}");
        }
        json.Append("]}");
        Console.WriteLine(json.ToString());
    }

    private static List<AudioSessionItem> ListAudioSessions(int excludePid)
    {
        Dictionary<int, AudioSessionItem> byPid = new Dictionary<int, AudioSessionItem>();
        HashSet<int> excludedPids = GetProcessTreePids(excludePid);
        IMMDeviceEnumerator enumerator = null;
        IMMDevice device = null;
        IAudioSessionManager2 manager = null;
        IAudioSessionEnumerator sessionEnumerator = null;

        try
        {
            enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device));

            Guid managerGuid = typeof(IAudioSessionManager2).GUID;
            object managerObject;
            Marshal.ThrowExceptionForHR(device.Activate(ref managerGuid, ClsctxAll, IntPtr.Zero, out managerObject));
            manager = (IAudioSessionManager2)managerObject;

            int count;
            Marshal.ThrowExceptionForHR(manager.GetSessionEnumerator(out sessionEnumerator));
            Marshal.ThrowExceptionForHR(sessionEnumerator.GetCount(out count));

            for (int i = 0; i < count; i += 1)
            {
                IAudioSessionControl control = null;
                try
                {
                    Marshal.ThrowExceptionForHR(sessionEnumerator.GetSession(i, out control));
                    IAudioSessionControl2 control2 = control as IAudioSessionControl2;
                    if (control2 == null) continue;

                    uint rawPid;
                    Marshal.ThrowExceptionForHR(control2.GetProcessId(out rawPid));
                    int pid = unchecked((int)rawPid);
                    if (pid <= 0 || excludedPids.Contains(pid) || byPid.ContainsKey(pid)) continue;

                    AudioSessionState state;
                    Marshal.ThrowExceptionForHR(control.GetState(out state));
                    AudioSessionItem item = CreateSessionItem(pid, state);
                    if (String.IsNullOrEmpty(item.Name)) continue;
                    byPid[pid] = item;
                }
                finally
                {
                    Release(control);
                }
            }
        }
        finally
        {
            Release(sessionEnumerator);
            Release(manager);
            Release(device);
            Release(enumerator);
        }

        AddVisibleWindowProcesses(byPid, excludedPids);
        AddMainWindowProcesses(byPid, excludedPids);

        List<AudioSessionItem> items = new List<AudioSessionItem>(byPid.Values);
        items.Sort(delegate(AudioSessionItem left, AudioSessionItem right)
        {
            int stateCompare = StateRank(left.State).CompareTo(StateRank(right.State));
            if (stateCompare != 0) return stateCompare;
            return String.Compare(left.Name, right.Name, StringComparison.CurrentCultureIgnoreCase);
        });

        List<AudioSessionItem> deduped = new List<AudioSessionItem>();
        Dictionary<string, AudioSessionItem> byName = new Dictionary<string, AudioSessionItem>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < items.Count && deduped.Count < 80; i += 1)
        {
            if (!ShouldShowAudioSessionItem(items[i])) continue;
            string key = GetAudioSessionDedupKey(items[i]);
            AudioSessionItem existing;
            if (byName.TryGetValue(key, out existing))
            {
                MergeAudioSessionItem(existing, items[i]);
                continue;
            }
            byName[key] = items[i];
            deduped.Add(items[i]);
        }
        ExpandRelatedProcessPids(deduped, excludedPids);
        return deduped;
    }

    private static string GetAudioSessionDedupKey(AudioSessionItem item)
    {
        if (!String.IsNullOrWhiteSpace(item.AppId)) return "app:" + item.AppId;
        if (!String.IsNullOrWhiteSpace(item.PackageFamilyName)) return "pkg:" + item.PackageFamilyName;
        if (!String.IsNullOrWhiteSpace(item.Name)) return "name:" + item.Name;
        return "pid:" + item.Pid;
    }

    private static bool ShouldShowAudioSessionItem(AudioSessionItem item)
    {
        if (item == null || item.Pid <= 0 || String.IsNullOrWhiteSpace(item.Name)) return false;
        if (!String.IsNullOrWhiteSpace(item.Title)) return true;
        if (item.State == "active") return true;
        return !IsLikelyBackgroundProcessName(item.Name);
    }

    private static void MergeAudioSessionItem(AudioSessionItem target, AudioSessionItem source)
    {
        if (source == null) return;
        if (!target.Pids.Contains(source.Pid)) target.Pids.Add(source.Pid);
        for (int i = 0; i < source.Pids.Count; i += 1)
        {
            if (!target.Pids.Contains(source.Pids[i])) target.Pids.Add(source.Pids[i]);
        }
        if (String.IsNullOrWhiteSpace(target.Title) && !String.IsNullOrWhiteSpace(source.Title)) target.Title = source.Title;
        if (String.IsNullOrWhiteSpace(target.Path) && !String.IsNullOrWhiteSpace(source.Path)) target.Path = source.Path;
        if (String.IsNullOrWhiteSpace(target.AppId) && !String.IsNullOrWhiteSpace(source.AppId)) target.AppId = source.AppId;
        if (String.IsNullOrWhiteSpace(target.PackageFamilyName) && !String.IsNullOrWhiteSpace(source.PackageFamilyName)) target.PackageFamilyName = source.PackageFamilyName;
        if (StateRank(source.State) < StateRank(target.State)) target.State = source.State;
    }

    private static void ExpandRelatedProcessPids(List<AudioSessionItem> items, HashSet<int> excludedPids)
    {
        Dictionary<string, List<int>> pidsByPackage = new Dictionary<string, List<int>>(StringComparer.OrdinalIgnoreCase);
        Dictionary<string, List<int>> pidsByAppId = new Dictionary<string, List<int>>(StringComparer.OrdinalIgnoreCase);
        Process[] processes = Process.GetProcesses();

        for (int i = 0; i < processes.Length; i += 1)
        {
            Process process = processes[i];
            try
            {
                int pid = process.Id;
                if (pid <= 0 || excludedPids.Contains(pid)) continue;

                string packageFamily = GetPackageFamilyNameForProcess(pid);
                if (!String.IsNullOrWhiteSpace(packageFamily))
                {
                    AddGroupedPid(pidsByPackage, packageFamily, pid);
                }

                string appId = GetAppUserModelId(pid);
                if (!String.IsNullOrWhiteSpace(appId))
                {
                    AddGroupedPid(pidsByAppId, appId, pid);
                }
            }
            catch {}
            finally
            {
                process.Dispose();
            }
        }

        for (int i = 0; i < items.Count; i += 1)
        {
            AudioSessionItem item = items[i];
            // 트리 전체를 넣으면 이 앱이 실행한 다른 앱(예: Discord 링크로 연 크롬)의
            // pid까지 항목에 섞인다. 같은 실행파일 이름의 프로세스만 관련 pid로 취급한다.
            AddRelatedPids(item, FilterTreePidsToSameApp(item.Pid, GetProcessTreePids(item.Pid)), excludedPids);

            if (!String.IsNullOrWhiteSpace(item.PackageFamilyName))
            {
                List<int> packagePids;
                if (pidsByPackage.TryGetValue(item.PackageFamilyName, out packagePids))
                {
                    AddRelatedPids(item, packagePids, excludedPids);
                }
            }

            if (!String.IsNullOrWhiteSpace(item.AppId))
            {
                List<int> appPids;
                if (pidsByAppId.TryGetValue(item.AppId, out appPids))
                {
                    AddRelatedPids(item, appPids, excludedPids);
                }
            }
        }
    }

    private static List<int> FilterTreePidsToSameApp(int rootPid, HashSet<int> treePids)
    {
        string rootName = GetProcessNameSafe(rootPid);
        List<int> result = new List<int>();
        foreach (int pid in treePids)
        {
            if (pid == rootPid)
            {
                result.Add(pid);
                continue;
            }
            if (String.IsNullOrEmpty(rootName)) continue;
            if (String.Equals(GetProcessNameSafe(pid), rootName, StringComparison.OrdinalIgnoreCase))
            {
                result.Add(pid);
            }
        }
        return result;
    }

    private static string GetProcessNameSafe(int pid)
    {
        try
        {
            using (Process process = Process.GetProcessById(pid))
            {
                return process.ProcessName ?? "";
            }
        }
        catch
        {
            return "";
        }
    }

    private static void AddGroupedPid(Dictionary<string, List<int>> groups, string key, int pid)
    {
        List<int> pids;
        if (!groups.TryGetValue(key, out pids))
        {
            pids = new List<int>();
            groups[key] = pids;
        }
        if (!pids.Contains(pid)) pids.Add(pid);
    }

    private static void AddRelatedPids(AudioSessionItem item, IEnumerable<int> pids, HashSet<int> excludedPids)
    {
        foreach (int pid in pids)
        {
            if (pid <= 0 || excludedPids.Contains(pid) || item.Pids.Contains(pid)) continue;
            item.Pids.Add(pid);
        }
    }

    private static void AddUserProcessCandidates(Dictionary<int, AudioSessionItem> byPid, HashSet<int> excludedPids)
    {
        int currentSession = Process.GetCurrentProcess().SessionId;
        Process[] processes = Process.GetProcesses();
        HashSet<string> addedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        for (int i = 0; i < processes.Length; i += 1)
        {
            Process process = processes[i];
            try
            {
                int pid = process.Id;
                string name = process.ProcessName;
                if (pid <= 0 || excludedPids.Contains(pid) || byPid.ContainsKey(pid)) continue;
                if (String.IsNullOrWhiteSpace(name) || addedNames.Contains(name)) continue;
                if (process.SessionId != currentSession) continue;
                if (IsSameNamedChildProcess(process)) continue;

                AudioSessionItem item = CreateSessionItem(pid, AudioSessionState.AudioSessionStateInactive);
                if (!IsLikelyUserAppProcess(item, name)) continue;

                item.State = "ready";
                byPid[pid] = item;
                addedNames.Add(name);
            }
            catch {}
            finally
            {
                process.Dispose();
            }
        }
    }

    private static bool IsSameNamedChildProcess(Process process)
    {
        int parentPid = GetParentProcessId(process.Id);
        if (parentPid <= 0) return false;
        try
        {
            Process parent = Process.GetProcessById(parentPid);
            try
            {
                return String.Equals(parent.ProcessName, process.ProcessName, StringComparison.OrdinalIgnoreCase);
            }
            finally
            {
                parent.Dispose();
            }
        }
        catch
        {
            return false;
        }
    }

    private static bool IsLikelyUserAppProcess(AudioSessionItem item, string processName)
    {
        if (!String.IsNullOrWhiteSpace(item.Title)) return true;
        if (IsLikelyBackgroundProcessName(processName)) return false;
        if (String.IsNullOrWhiteSpace(item.Path)) return false;

        string path = item.Path;
        if (path.StartsWith(Environment.GetFolderPath(Environment.SpecialFolder.Windows), StringComparison.OrdinalIgnoreCase)) return false;
        if (path.IndexOf("\\WindowsApps\\", StringComparison.OrdinalIgnoreCase) >= 0) return true;
        if (path.IndexOf("\\AppData\\", StringComparison.OrdinalIgnoreCase) >= 0) return true;
        if (path.IndexOf("\\Program Files", StringComparison.OrdinalIgnoreCase) >= 0) return true;
        if (path.IndexOf("\\SteamLibrary\\", StringComparison.OrdinalIgnoreCase) >= 0) return true;

        return processName.Equals("chrome", StringComparison.OrdinalIgnoreCase) ||
            processName.Equals("msedge", StringComparison.OrdinalIgnoreCase) ||
            processName.Equals("firefox", StringComparison.OrdinalIgnoreCase) ||
            processName.Equals("Discord", StringComparison.OrdinalIgnoreCase) ||
            processName.Equals("LocalSend", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsLikelyBackgroundProcessName(string processName)
    {
        string name = processName ?? "";
        return name.StartsWith("aw-", StringComparison.OrdinalIgnoreCase) ||
            name.IndexOf("crash", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("service", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("server", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("watcher", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("helper", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("daemon", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("agent", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("tray", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("update", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("widget", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("webview", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("host", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("feedprovider", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.StartsWith("PowerToys.", StringComparison.OrdinalIgnoreCase);
    }

    private static void AddVisibleWindowProcesses(Dictionary<int, AudioSessionItem> byPid, HashSet<int> excludedPids)
    {
        EnumWindows(delegate(IntPtr hwnd, IntPtr lParam)
        {
            if (!IsWindowVisible(hwnd)) return true;
            int titleLength = GetWindowTextLength(hwnd);
            if (titleLength <= 0) return true;

            uint rawPid;
            GetWindowThreadProcessId(hwnd, out rawPid);
            int pid = unchecked((int)rawPid);
            if (pid <= 0 || excludedPids.Contains(pid)) return true;
            if (IsLikelyBackgroundProcessName(GetSafeProcessName(pid))) return true;

            StringBuilder title = new StringBuilder(titleLength + 1);
            GetWindowText(hwnd, title, title.Capacity);
            if (String.IsNullOrWhiteSpace(title.ToString())) return true;

            AudioSessionItem existing;
            if (byPid.TryGetValue(pid, out existing))
            {
                if (String.IsNullOrEmpty(existing.Title)) existing.Title = title.ToString();
                return true;
            }

            AudioSessionItem item = CreateSessionItem(pid, AudioSessionState.AudioSessionStateInactive);
            item.Title = title.ToString();
            item.State = "ready";
            if (!String.IsNullOrEmpty(item.Name)) byPid[pid] = item;
            return true;
        }, IntPtr.Zero);
    }

    private static void AddMainWindowProcesses(Dictionary<int, AudioSessionItem> byPid, HashSet<int> excludedPids)
    {
        Process[] processes = Process.GetProcesses();
        for (int i = 0; i < processes.Length; i += 1)
        {
            Process process = processes[i];
            try
            {
                int pid = process.Id;
                if (pid <= 0 || excludedPids.Contains(pid) || byPid.ContainsKey(pid)) continue;
                if (IsLikelyBackgroundProcessName(process.ProcessName)) continue;
                string title = process.MainWindowTitle;
                if (String.IsNullOrWhiteSpace(title)) continue;

                AudioSessionItem item = CreateSessionItem(pid, AudioSessionState.AudioSessionStateInactive);
                item.Title = title;
                item.State = "ready";
                if (!String.IsNullOrEmpty(item.Name)) byPid[pid] = item;
            }
            catch {}
            finally
            {
                process.Dispose();
            }
        }
    }

    private static List<int> GetPidListArg(string[] args, string name)
    {
        List<int> pids = new List<int>();
        for (int i = 0; i < args.Length - 1; i += 1)
        {
            if (!String.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) continue;
            string[] parts = args[i + 1].Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (string part in parts)
            {
                int pid;
                if (int.TryParse(part.Trim(), out pid) && pid > 0 && !pids.Contains(pid)) pids.Add(pid);
            }
        }
        return pids;
    }

    // 캡처는 IncludeTargetProcessTree 모드라 조상 pid 하나가 자손 전체의 오디오를 잡는다.
    // 다른 선택 pid의 자손인 pid를 캡처하면 같은 오디오가 중복 합산되어
    // 음이 증폭/클리핑되고 콤 필터로 먹먹해지므로, 트리 루트만 남긴다.
    private static void WriteDedupedPids(List<int> pids)
    {
        Dictionary<int, HashSet<int>> trees = new Dictionary<int, HashSet<int>>();
        foreach (int pid in pids)
        {
            if (!trees.ContainsKey(pid)) trees[pid] = GetProcessTreePids(pid);
        }

        List<int> keep = new List<int>();
        foreach (int pid in pids)
        {
            bool covered = false;
            foreach (int other in pids)
            {
                if (other == pid) continue;
                HashSet<int> otherTree;
                if (!trees.TryGetValue(other, out otherTree)) continue;
                if (otherTree.Contains(pid))
                {
                    covered = true;
                    break;
                }
            }
            if (!covered) keep.Add(pid);
        }

        if (keep.Count == 0) keep = pids;

        StringBuilder json = new StringBuilder();
        json.Append("{\"ok\":true,\"pids\":[");
        for (int i = 0; i < keep.Count; i += 1)
        {
            if (i > 0) json.Append(',');
            json.Append(keep[i]);
        }
        json.Append("]}");
        Console.WriteLine(json.ToString());
    }

    private static HashSet<int> GetProcessTreePids(int rootPid)
    {
        HashSet<int> result = new HashSet<int>();
        if (rootPid <= 0) return result;

        result.Add(rootPid);
        bool changed = true;
        while (changed)
        {
            changed = false;
            Process[] processes = Process.GetProcesses();
            for (int i = 0; i < processes.Length; i += 1)
            {
                Process process = processes[i];
                try
                {
                    int pid = process.Id;
                    if (result.Contains(pid)) continue;
                    int parentPid = GetParentProcessId(pid);
                    if (!result.Contains(parentPid)) continue;
                    result.Add(pid);
                    changed = true;
                }
                catch {}
                finally
                {
                    process.Dispose();
                }
            }
        }

        return result;
    }

    private static int GetParentProcessId(int pid)
    {
        IntPtr handle = OpenProcess(0x1000, false, pid);
        if (handle == IntPtr.Zero) return -1;

        try
        {
            ProcessBasicInformation info = new ProcessBasicInformation();
            int returnLength;
            int status = NtQueryInformationProcess(handle, 0, ref info, Marshal.SizeOf(typeof(ProcessBasicInformation)), out returnLength);
            if (status != 0) return -1;
            return unchecked((int)info.InheritedFromUniqueProcessId.ToInt64());
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    private static int StateRank(string state)
    {
        if (state == "active") return 0;
        if (state == "ready") return 1;
        if (state == "inactive") return 2;
        return 3;
    }

    private static bool InitializeRuntime()
    {
        int coHr = CoInitializeEx(IntPtr.Zero, 0);
        if (coHr < 0 && coHr != unchecked((int)0x80010106)) Marshal.ThrowExceptionForHR(coHr);
        int hr = RoInitialize(1);
        if (hr == 0 || hr == 1) return true;
        const int RpcEChangedMode = unchecked((int)0x80010106);
        if (hr == RpcEChangedMode) return false;
        Marshal.ThrowExceptionForHR(hr);
        return false;
    }

    private static string GetSafeProcessName(int pid)
    {
        try
        {
            Process process = Process.GetProcessById(pid);
            try
            {
                return process.ProcessName ?? "";
            }
            finally
            {
                process.Dispose();
            }
        }
        catch
        {
            return "";
        }
    }

    private static AudioSessionItem CreateSessionItem(int pid, AudioSessionState state)
    {
        AudioSessionItem item = new AudioSessionItem();
        item.Pid = pid;
        item.Pids.Add(pid);
        item.State = state == AudioSessionState.AudioSessionStateActive ? "active" :
            state == AudioSessionState.AudioSessionStateInactive ? "inactive" : "expired";

        try
        {
            Process process = Process.GetProcessById(pid);
            item.Name = String.IsNullOrWhiteSpace(process.ProcessName) ? ("PID " + pid) : process.ProcessName;
            item.Title = process.MainWindowTitle ?? "";
            try
            {
                item.Path = process.MainModule == null ? "" : process.MainModule.FileName;
            }
            catch
            {
                item.Path = "";
            }
            string friendlyName = GetFriendlyProcessName(item.Path);
            if (!String.IsNullOrWhiteSpace(friendlyName)) item.Name = friendlyName;
        }
        catch
        {
            item.Name = "PID " + pid;
            item.Title = "";
            item.Path = "";
        }
        item.AppId = GetAppUserModelId(pid);
        item.PackageFamilyName = GetPackageFamilyNameForProcess(pid);

        return item;
    }

    private static string GetAppUserModelId(int pid)
    {
        IntPtr handle = OpenProcess(0x1000, false, pid);
        if (handle == IntPtr.Zero) return "";

        try
        {
            int length = 0;
            GetApplicationUserModelId(handle, ref length, null);
            if (length <= 0) return "";

            StringBuilder appId = new StringBuilder(length);
            int result = GetApplicationUserModelId(handle, ref length, appId);
            return result == 0 ? appId.ToString() : "";
        }
        catch
        {
            return "";
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    private static string GetPackageFamilyNameForProcess(int pid)
    {
        IntPtr handle = OpenProcess(0x1000, false, pid);
        if (handle == IntPtr.Zero) return "";

        try
        {
            int length = 0;
            GetPackageFamilyName(handle, ref length, null);
            if (length <= 0) return "";

            StringBuilder packageFamilyName = new StringBuilder(length);
            int result = GetPackageFamilyName(handle, ref length, packageFamilyName);
            return result == 0 ? packageFamilyName.ToString() : "";
        }
        catch
        {
            return "";
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    private static string GetFriendlyProcessName(string path)
    {
        if (String.IsNullOrWhiteSpace(path)) return "";
        try
        {
            FileVersionInfo info = FileVersionInfo.GetVersionInfo(path);
            if (!String.IsNullOrWhiteSpace(info.FileDescription)) return info.FileDescription;
            if (!String.IsNullOrWhiteSpace(info.ProductName)) return info.ProductName;
        }
        catch {}
        return "";
    }

    private static void CaptureProcessLoopback(int pid, int sampleRate, int channels)
    {
        Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs eventArgs)
        {
            eventArgs.Cancel = true;
            s_stopping = true;
        };

        IntPtr formatPtr = IntPtr.Zero;
        IAudioClient audioClient = null;
        IAudioCaptureClient captureClient = null;

        try
        {
            audioClient = ActivateProcessLoopbackClient(pid);
            WaveFormatEx format = WaveFormatEx.CreateFloatPcm(sampleRate, channels);
            formatPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WaveFormatEx)));
            Marshal.StructureToPtr(format, formatPtr, false);

            Guid sessionGuid = Guid.Empty;
            long bufferDuration = 1000000; // 100 ms in 100 ns units.
            uint flags = AudclntStreamflagsLoopback | AudclntStreamflagsAutoconvertpcm | AudclntStreamflagsSrcDefaultQuality;
            CheckHr("IAudioClient.Initialize", audioClient.Initialize(AudioClientShareMode.Shared, flags, bufferDuration, 0, formatPtr, ref sessionGuid));

            Guid captureGuid = typeof(IAudioCaptureClient).GUID;
            object captureObject;
            CheckHr("IAudioClient.GetService", audioClient.GetService(ref captureGuid, out captureObject));
            captureClient = (IAudioCaptureClient)captureObject;

            Stream output = Console.OpenStandardOutput();
            int frameBytes = channels * sizeof(float);
            CheckHr("IAudioClient.Start", audioClient.Start());

            while (!s_stopping)
            {
                uint packetFrames;
                CheckHr("IAudioCaptureClient.GetNextPacketSize", captureClient.GetNextPacketSize(out packetFrames));
                if (packetFrames == 0)
                {
                    Thread.Sleep(4);
                    continue;
                }

                while (packetFrames > 0)
                {
                    IntPtr data;
                    uint frames;
                    uint packetFlags;
                    ulong devicePosition;
                    ulong qpcPosition;
                    CheckHr("IAudioCaptureClient.GetBuffer", captureClient.GetBuffer(out data, out frames, out packetFlags, out devicePosition, out qpcPosition));

                    int byteCount = checked((int)frames * frameBytes);
                    byte[] buffer = new byte[byteCount];
                    if ((packetFlags & AudclntBufferflagsSilent) == 0 && data != IntPtr.Zero)
                    {
                        Marshal.Copy(data, buffer, 0, byteCount);
                    }

                    CheckHr("IAudioCaptureClient.ReleaseBuffer", captureClient.ReleaseBuffer(frames));
                    output.Write(buffer, 0, buffer.Length);
                    output.Flush();

                    CheckHr("IAudioCaptureClient.GetNextPacketSize", captureClient.GetNextPacketSize(out packetFrames));
                }
            }
        }
        finally
        {
            try
            {
                if (audioClient != null) audioClient.Stop();
            }
            catch {}
            if (formatPtr != IntPtr.Zero) Marshal.FreeHGlobal(formatPtr);
            Release(captureClient);
            Release(audioClient);
        }
    }

    private static IAudioClient ActivateProcessLoopbackClient(int pid)
    {
        Guid audioClientGuid = typeof(IAudioClient).GUID;
        AudioClientActivationParams activationParams = new AudioClientActivationParams();
        activationParams.ActivationType = AudioClientActivationType.ProcessLoopback;
        activationParams.ProcessLoopbackParams.TargetProcessId = (uint)pid;
        activationParams.ProcessLoopbackParams.ProcessLoopbackMode = ProcessLoopbackMode.IncludeTargetProcessTree;

        IntPtr activationParamsPtr = IntPtr.Zero;
        IntPtr propVariantPtr = IntPtr.Zero;
        CompletionHandler completionHandler = new CompletionHandler();
        IntPtr operation = IntPtr.Zero;

        try
        {
            activationParamsPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(AudioClientActivationParams)));
            Marshal.StructureToPtr(activationParams, activationParamsPtr, false);

            PropVariant propVariant = new PropVariant();
            propVariant.vt = VtBlob;
            propVariant.blobSize = Marshal.SizeOf(typeof(AudioClientActivationParams));
            propVariant.blobData = activationParamsPtr;
            propVariantPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(PropVariant)));
            Marshal.StructureToPtr(propVariant, propVariantPtr, false);

            CheckHr("ActivateAudioInterfaceAsync", ActivateAudioInterfaceAsync(LoopbackDevice, ref audioClientGuid, propVariantPtr, completionHandler.Pointer, out operation));

            if (!completionHandler.Wait(8000))
            {
                throw new TimeoutException("Timed out while opening Windows process loopback.");
            }

            CheckHr("Process loopback activation", completionHandler.ActivateResult);
            IAudioClient client = completionHandler.ActivatedInterface as IAudioClient;
            if (client == null) throw new InvalidOperationException("Windows process loopback did not return IAudioClient.");
            return client;
        }
        finally
        {
            if (propVariantPtr != IntPtr.Zero) Marshal.FreeHGlobal(propVariantPtr);
            if (activationParamsPtr != IntPtr.Zero) Marshal.FreeHGlobal(activationParamsPtr);
            if (operation != IntPtr.Zero) Marshal.Release(operation);
            completionHandler.Dispose();
        }
    }

    private static void Release(object comObject)
    {
        if (comObject != null && Marshal.IsComObject(comObject))
        {
            Marshal.ReleaseComObject(comObject);
        }
    }

    private static void CheckHr(string step, int hr)
    {
        if (hr >= 0) return;
        throw new COMException(step + " failed: 0x" + hr.ToString("X8"), hr);
    }

    private static string JsonEscape(string value)
    {
        if (String.IsNullOrEmpty(value)) return "";
        StringBuilder builder = new StringBuilder(value.Length + 8);
        for (int i = 0; i < value.Length; i += 1)
        {
            char c = value[i];
            if (c == '\\') builder.Append("\\\\");
            else if (c == '"') builder.Append("\\\"");
            else if (c == '\b') builder.Append("\\b");
            else if (c == '\f') builder.Append("\\f");
            else if (c == '\n') builder.Append("\\n");
            else if (c == '\r') builder.Append("\\r");
            else if (c == '\t') builder.Append("\\t");
            else if (c < 32) builder.Append("\\u").Append(((int)c).ToString("x4"));
            else builder.Append(c);
        }
        return builder.ToString();
    }

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = true)]
    private static extern int ActivateAudioInterfaceAsync(
        [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
        ref Guid riid,
        IntPtr activationParams,
        IntPtr completionHandler,
        out IntPtr activationOperation);

    [DllImport("combase.dll")]
    private static extern int RoInitialize(int initType);

    [DllImport("combase.dll")]
    private static extern void RoUninitialize();

    [DllImport("ole32.dll")]
    private static extern int CoInitializeEx(IntPtr reserved, int coInit);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(int desiredAccess, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(
        IntPtr processHandle,
        int processInformationClass,
        ref ProcessBasicInformation processInformation,
        int processInformationLength,
        out int returnLength);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetApplicationUserModelId(IntPtr processHandle, ref int applicationUserModelIdLength, StringBuilder applicationUserModelId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetPackageFamilyName(IntPtr processHandle, ref int packageFamilyNameLength, StringBuilder packageFamilyName);

    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsProc enumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowTextLength(IntPtr hwnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    private sealed class AudioSessionItem
    {
        public int Pid;
        public List<int> Pids = new List<int>();
        public string Name;
        public string Title;
        public string Path;
        public string AppId;
        public string PackageFamilyName;
        public string State;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessBasicInformation
    {
        public IntPtr Reserved1;
        public IntPtr PebBaseAddress;
        public IntPtr Reserved2A;
        public IntPtr Reserved2B;
        public IntPtr UniqueProcessId;
        public IntPtr InheritedFromUniqueProcessId;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    private struct WaveFormatEx
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;

        public static WaveFormatEx CreateFloatPcm(int sampleRate, int channels)
        {
            WaveFormatEx format = new WaveFormatEx();
            format.wFormatTag = WaveFormatIeeeFloat;
            format.nChannels = (ushort)channels;
            format.nSamplesPerSec = (uint)sampleRate;
            format.wBitsPerSample = 32;
            format.nBlockAlign = (ushort)(channels * 4);
            format.nAvgBytesPerSec = (uint)(sampleRate * format.nBlockAlign);
            format.cbSize = 0;
            return format;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct AudioClientProcessLoopbackParams
    {
        public uint TargetProcessId;
        public ProcessLoopbackMode ProcessLoopbackMode;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct AudioClientActivationParams
    {
        public AudioClientActivationType ActivationType;
        public AudioClientProcessLoopbackParams ProcessLoopbackParams;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct PropVariant
    {
        [FieldOffset(0)]
        public ushort vt;
        [FieldOffset(2)]
        public ushort wReserved1;
        [FieldOffset(4)]
        public ushort wReserved2;
        [FieldOffset(6)]
        public ushort wReserved3;
        [FieldOffset(8)]
        public int blobSize;
        [FieldOffset(16)]
        public IntPtr blobData;
    }

    private enum AudioClientActivationType
    {
        Default = 0,
        ProcessLoopback = 1
    }

    private enum ProcessLoopbackMode
    {
        IncludeTargetProcessTree = 0,
        ExcludeTargetProcessTree = 1
    }

    private enum AudioClientShareMode
    {
        Shared = 0,
        Exclusive = 1
    }

    private enum EDataFlow
    {
        eRender = 0,
        eCapture = 1,
        eAll = 2
    }

    private enum ERole
    {
        eConsole = 0,
        eMultimedia = 1,
        eCommunications = 2
    }

    private enum AudioSessionState
    {
        AudioSessionStateInactive = 0,
        AudioSessionStateActive = 1,
        AudioSessionStateExpired = 2
    }

    [ComImport]
    [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumerator
    {
    }

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(EDataFlow dataFlow, uint dwStateMask, out object ppDevices);
        int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppEndpoint);
        int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IMMDevice ppDevice);
        int RegisterEndpointNotificationCallback(IntPtr pClient);
        int UnregisterEndpointNotificationCallback(IntPtr pClient);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        int OpenPropertyStore(int stgmAccess, out object ppProperties);
        int GetId(out IntPtr ppstrId);
        int GetState(out uint pdwState);
    }

    [ComImport]
    [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionManager2
    {
        int GetAudioSessionControl(IntPtr audioSessionGuid, uint streamFlags, out IAudioSessionControl sessionControl);
        int GetSimpleAudioVolume(IntPtr audioSessionGuid, uint streamFlags, out object audioVolume);
        int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnum);
        int RegisterSessionNotification(IntPtr sessionNotification);
        int UnregisterSessionNotification(IntPtr sessionNotification);
        int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string sessionId, IntPtr duckNotification);
        int UnregisterDuckNotification(IntPtr duckNotification);
    }

    [ComImport]
    [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionEnumerator
    {
        int GetCount(out int sessionCount);
        int GetSession(int sessionCount, out IAudioSessionControl session);
    }

    [ComImport]
    [Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionControl
    {
        int GetState(out AudioSessionState state);
        int GetDisplayName(out IntPtr displayName);
        int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);
        int GetIconPath(out IntPtr iconPath);
        int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);
        int GetGroupingParam(out Guid groupingId);
        int SetGroupingParam(ref Guid groupingId, ref Guid eventContext);
        int RegisterAudioSessionNotification(IntPtr client);
        int UnregisterAudioSessionNotification(IntPtr client);
    }

    [ComImport]
    [Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionControl2
    {
        int GetState(out AudioSessionState state);
        int GetDisplayName(out IntPtr displayName);
        int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);
        int GetIconPath(out IntPtr iconPath);
        int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);
        int GetGroupingParam(out Guid groupingId);
        int SetGroupingParam(ref Guid groupingId, ref Guid eventContext);
        int RegisterAudioSessionNotification(IntPtr client);
        int UnregisterAudioSessionNotification(IntPtr client);
        int GetSessionIdentifier(out IntPtr retVal);
        int GetSessionInstanceIdentifier(out IntPtr retVal);
        int GetProcessId(out uint retVal);
        int IsSystemSoundsSession();
        int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
    }

    [ComImport]
    [Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioClient
    {
        int Initialize(AudioClientShareMode shareMode, uint streamFlags, long hnsBufferDuration, long hnsPeriodicity, IntPtr waveFormat, ref Guid audioSessionGuid);
        int GetBufferSize(out uint bufferSize);
        int GetStreamLatency(out long latency);
        int GetCurrentPadding(out uint currentPadding);
        int IsFormatSupported(AudioClientShareMode shareMode, IntPtr waveFormat, out IntPtr closestMatch);
        int GetMixFormat(out IntPtr deviceFormat);
        int GetDevicePeriod(out long defaultDevicePeriod, out long minimumDevicePeriod);
        int Start();
        int Stop();
        int Reset();
        int SetEventHandle(IntPtr eventHandle);
        int GetService(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport]
    [Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioCaptureClient
    {
        int GetBuffer(out IntPtr dataBuffer, out uint numFramesToRead, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        int ReleaseBuffer(uint numFramesRead);
        int GetNextPacketSize(out uint numFramesInNextPacket);
    }

    [ComImport]
    [Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IActivateAudioInterfaceAsyncOperation
    {
        [PreserveSig]
        int GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int QueryInterfaceDelegate(IntPtr self, ref Guid riid, out IntPtr ppv);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate uint AddRefDelegate(IntPtr self);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate uint ReleaseDelegate(IntPtr self);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int ActivateCompletedDelegate(IntPtr self, IntPtr activateOperation);

    private sealed class CompletionHandler : IDisposable
    {
        private static readonly Guid IidIUnknown = new Guid("00000000-0000-0000-C000-000000000046");
        private static readonly Guid IidCompletionHandler = new Guid("41D949AB-9862-444A-80F6-C261334DA5EB");
        private static readonly Guid IidAgileObject = new Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90");

        private readonly ManualResetEvent _completed = new ManualResetEvent(false);
        private readonly QueryInterfaceDelegate _queryInterface;
        private readonly AddRefDelegate _addRef;
        private readonly ReleaseDelegate _release;
        private readonly ActivateCompletedDelegate _activateCompleted;
        private readonly IntPtr _vtable;
        private readonly IntPtr _self;
        private int _refCount = 1;

        public int ActivateResult { get; private set; }
        public object ActivatedInterface { get; private set; }
        public IntPtr Pointer { get { return _self; } }

        public CompletionHandler()
        {
            _queryInterface = QueryInterface;
            _addRef = AddRef;
            _release = Release;
            _activateCompleted = ActivateCompleted;

            _vtable = Marshal.AllocHGlobal(IntPtr.Size * 4);
            Marshal.WriteIntPtr(_vtable, 0, Marshal.GetFunctionPointerForDelegate(_queryInterface));
            Marshal.WriteIntPtr(_vtable, IntPtr.Size, Marshal.GetFunctionPointerForDelegate(_addRef));
            Marshal.WriteIntPtr(_vtable, IntPtr.Size * 2, Marshal.GetFunctionPointerForDelegate(_release));
            Marshal.WriteIntPtr(_vtable, IntPtr.Size * 3, Marshal.GetFunctionPointerForDelegate(_activateCompleted));

            _self = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(_self, _vtable);
        }

        private int QueryInterface(IntPtr self, ref Guid riid, out IntPtr ppv)
        {
            if (riid == IidIUnknown || riid == IidCompletionHandler || riid == IidAgileObject)
            {
                ppv = _self;
                AddRef(_self);
                return 0;
            }

            ppv = IntPtr.Zero;
            return unchecked((int)0x80004002);
        }

        private uint AddRef(IntPtr self)
        {
            return (uint)Interlocked.Increment(ref _refCount);
        }

        private uint Release(IntPtr self)
        {
            int value = Interlocked.Decrement(ref _refCount);
            return (uint)Math.Max(0, value);
        }

        private int ActivateCompleted(IntPtr self, IntPtr activateOperation)
        {
            object operationObject = null;
            try
            {
                int result;
                object activatedInterface;
                operationObject = Marshal.GetObjectForIUnknown(activateOperation);
                IActivateAudioInterfaceAsyncOperation operation = (IActivateAudioInterfaceAsyncOperation)operationObject;
                int operationResult = operation.GetActivateResult(out result, out activatedInterface);
                ActivateResult = operationResult < 0 ? operationResult : result;
                ActivatedInterface = activatedInterface;
                return 0;
            }
            catch
            {
                ActivateResult = unchecked((int)0x80004005);
                return ActivateResult;
            }
            finally
            {
                if (operationObject != null && Marshal.IsComObject(operationObject)) Marshal.ReleaseComObject(operationObject);
                _completed.Set();
            }
        }

        public bool Wait(int millisecondsTimeout)
        {
            return _completed.WaitOne(millisecondsTimeout);
        }

        public void Dispose()
        {
            _completed.Close();
            if (_self != IntPtr.Zero) Marshal.FreeHGlobal(_self);
            if (_vtable != IntPtr.Zero) Marshal.FreeHGlobal(_vtable);
        }
    }
}
