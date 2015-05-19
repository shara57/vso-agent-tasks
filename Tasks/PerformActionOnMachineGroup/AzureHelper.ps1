function Delete-MachineGroupFromProvider
{
    param([string]$machineGroupName)

    Write-Verbose "Deleting resource group $machineGroupName from Azure provider" -Verbose
    Remove-AzureResourceGroup -ResourceGroupName $machineGroupName -Force -ErrorAction Stop -Verbose
    Write-Verbose "Deleted resource group $machineGroupName from Azure provider"-Verbose
}

function Delete-MachineFromProvider
{
    param([string]$machineGroupName,
          [string]$machineName)
    
    $errorVariable=@()
    Write-Verbose "Deleting machine $machineName from Azure provider" -Verbose
    $removeResponse = Remove-AzureVM -Name $machineName -ResourceGroupName $machineGroupName -Force -ErrorAction SilentlyContinue -ErrorVariable  errorVariable -Verbose

    if($errorVariable.Count -eq 0)
    {
         Write-Verbose "Deleted machine $machineName from Azure provider" -Verbose
         return "Succedded"
    }
    else
    {
         Write-Warning("Deletion of machine $machineName failed in azure with error $errorVaraible")
         return "Failed"
    }
}

function Start-MachineInProvider
{
    param([string]$machineGroupName,
          [string]$machineName)

    Write-Verbose "Starting machine $machineName on Azure provider" -Verbose
    Start-AzureVM -Name $machineName -ResourceGroupName $machineGroupName -ErrorAction SilentlyContinue -Verbose
    Write-Verbose "Started machine $machineName on Azure provider" -Verbose
}

function Stop-MachineInProvider
{
    param([string]$machineGroupName,
          [string]$machineName)

    Write-Verbose "Stopping machine $machineName on Azure provider" -Verbose
    Stop-AzureVM -Name $machineName -ResourceGroupName $machineGroupName -ErrorAction SilentlyContinue -Verbose -Force
    Write-Verbose "Stopped machine $machineName on Azure provider" -Verbose
}

function Restart-MachineInProvider
{
    param([string]$machineGroupName,
          [string]$machineName)

    Write-Verbose "Restarting machine $machineName on Azure provider" -Verbose
    Restart-AzureVM -Name $machineName -ResourceGroupName $machineGroupName -ErrorAction SilentlyContinue -Verbose 
    Write-Verbose "Restarted machine $machineName on Azure provider" -Verbose
}

function Initialize-AzureHelper
{
    Write-Verbose "Initializing azure resource provider" -Verbose

    Import-AzurePowerShellModule

    Switch-AzureMode AzureResourceManager

    if($machineGroup.ProviderDataList.Count -gt 0)
    {
        $providerDataName = $machineGroup.ProviderDataList[0].Name
        Write-Verbose "Getting providerData : $providerDataName" -Verbose
        $providerData = Get-ProviderData -ProviderDataName $providerDataName -Connection $connection
        $subscriptionName = $providerData.Properties.GetProperty("SubscriptionName")     
        $username = $providerData.Properties.GetProperty("Username")
        $password = $providerData.Properties.GetProperty("Password")

        if( ![string]::IsNullOrEmpty($subscriptionName) -and ![string]::IsNullOrEmpty($username) -and ![string]::IsNullOrEmpty($password) )
        {
            Write-Verbose "SubscriptionName : $subscriptionName" -Verbose
            Write-Verbose "Username : $username" -Verbose
            $securePassword = ConvertTo-SecureString $password -AsPlainText -Force
            $psCredential = New-Object System.Management.Automation.PSCredential ($username, $securePassword)
            $azureAccount = Add-AzureAccount -Credential $psCredential
            if(!$azureAccount)
            {
                throw "There was an error with the Azure credentials used for machine group deployment"
            }
            Select-AzureSubscription -SubscriptionName $subscriptionName
        }
        else
        {
            throw "ProviderData for machine group is containing null or empty values for either of subscriptionname, username or Password"
        }
    }
    else
    {
        throw "No providerdata is specified in machine group"
    }

    Write-Verbose "Initialized azure resource provider" -Verbose
}